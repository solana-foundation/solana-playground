/**
 * The one Postgres entry point for every API route.
 *
 * Plain `pg`, whichever provider builds the pool: every statement is
 * Postgres, so nothing here or above may depend on a vendor driver.
 * `DB_PROVIDER` names the provider (`providers/<name>.mjs`), `DATABASE_ENV`
 * lists the variables each needs, and each module exports `createPool(env)`;
 * nothing outside this file knows which one is behind the pool.
 */
import { databaseEnv } from "../../../shared/config/server-env.mjs";
import {
  DATABASE_ENV,
  isDatabaseProvider,
  missingDatabaseEnv,
} from "../config.mjs";
import * as cloudSql from "./providers/cloud-sql.mjs";
import * as url from "./providers/url.mjs";

/** Each provider's module, under the name `DATABASE_ENV` gives it */
const PROVIDERS = { url, "cloud-sql": cloudSql };

// The names are `DATABASE_ENV`'s keys and nowhere else: a provider in one table
// only would pass the build check while every request rejects, or the other
// way round. Checked on load, so every test that loads this file catches it.
const unmatched = Object.keys(DATABASE_ENV)
  .filter((name) => !Object.hasOwn(PROVIDERS, name))
  .concat(Object.keys(PROVIDERS).filter((name) => !isDatabaseProvider(name)));
if (unmatched.length) {
  throw new Error(
    `db: providers without both a DATABASE_ENV entry and a module: ${unmatched.join(
      ", "
    )}`
  );
}

/** @type {Promise<import("pg").Pool> | undefined} */
let pool;

/**
 * Whether a database is configured at all: the chosen provider has every
 * variable `DATABASE_ENV` lists for it, counting `""` as unset, as
 * `databaseEnv()` does.
 *
 * An unknown `DB_PROVIDER` counts as configured: somebody chose a provider,
 * and the deployment must report that choice as broken (`getPool` rejects
 * naming it) rather than as absent, which would read as "sync was never set
 * up here".
 */
export const isConfigured = () =>
  !isDatabaseProvider(databaseEnv().DB_PROVIDER) ||
  missingDatabaseEnv((name) => !!process.env[name]).length === 0;

/** Whether sync should serve traffic. The kill switch is opt-in. */
export const isEnabled = () => isConfigured() && databaseEnv().SYNC_ENABLED;

/**
 * Build the pool through the chosen provider. Never falls back to another
 * provider: a misspelled `DB_PROVIDER` beside a stray `DATABASE_URL` would
 * otherwise connect somewhere nobody chose.
 */
const open = async () => {
  const env = databaseEnv();
  if (!isDatabaseProvider(env.DB_PROVIDER)) {
    throw new Error(
      `DB_PROVIDER "${env.DB_PROVIDER}" names no database provider; ` +
        `expected one of: ${Object.keys(DATABASE_ENV).join(", ")}`
    );
  }
  const created = await PROVIDERS[env.DB_PROVIDER].createPool(env);
  // Without a listener, an error on an idle client is an unhandled 'error'
  // event, which takes the whole function down rather than the one query.
  // `pg` drops the client either way; logged, because an idle client dies on
  // instance maintenance, a failover or a dropped connector stream, and the
  // query failures that follow would otherwise have no visible cause
  created.on("error", (error) => {
    // eslint-disable-next-line no-console -- server-side: Vercel's function log is where this goes
    console.error("db: an idle client failed", {
      message: error.message,
      code: /** @type {{ code?: unknown }} */ (error).code,
    });
  });
  return created;
};

/**
 * The shared pool, created on first use.
 *
 * Async because a provider may need a network round trip before a pool can
 * exist (the Cloud SQL connector fetches a certificate and the instance's
 * address). The promise is memoised so a warm instance pays that once; a
 * rejected one is forgotten, so a transient failure is retried by the next
 * request rather than kept for the life of the instance.
 *
 * @returns {Promise<import("pg").Pool | null>} the pool, or `null` when no
 * database is configured
 */
export const getPool = async () => {
  if (!isConfigured()) return null;
  pool ??= open().catch((e) => {
    pool = undefined;
    throw e;
  });
  return pool;
};

/**
 * Run one statement on a caller's client, tagging any failure with its text.
 *
 * `pg` raises the server's error verbatim and attaches no SQL to it, so a
 * driver error reaching a route names neither the statement that produced it
 * nor the module it came from. For most codes that is survivable -- the
 * constraint name says enough -- but the schema-shaped ones say nothing at
 * all: `42P10` reports that an `on conflict` target matches no constraint
 * without naming either side of the comparison, and the two things that cause
 * it read identically in a log. Either the schema is behind the code, or the
 * code is behind the schema.
 *
 * The text here comes from the module that is actually loaded, which is the
 * half nothing else can reconstruct after the fact: compare it against the
 * source and a process serving a cached copy of an edited file -- which the
 * dev server does by design, see the note in `craco.config.js` -- stops
 * looking like a database problem.
 *
 * `??=` rather than `=`: an inner statement's text is the specific one, and a
 * caller that wraps this must not overwrite it with its own.
 *
 * @param {import("pg").PoolClient | import("pg").Pool} client
 * @param {string} text SQL with `$1`-style placeholders
 * @param {unknown[]} [params] bound values
 */
export const run = async (client, text, params) => {
  try {
    return await client.query(text, params);
  } catch (e) {
    e.statement ??= text;
    throw e;
  }
};

/**
 * Run one statement on the shared pool.
 *
 * @param {string} text SQL with `$1`-style placeholders
 * @param {unknown[]} [params] bound values
 */
export const query = async (text, params) => {
  const p = await getPool();
  if (!p) throw new Error("the database is not configured");
  return run(p, text, params);
};

/**
 * Run several statements as one unit on a single pooled client.
 *
 * A project write is a compare-and-swap on the `projects` row followed by
 * writes to its files. The swap's row lock is what serialises two writers, and
 * it is only held across the file writes if they share its transaction -- on
 * separate pool clients a second writer could land between them.
 *
 * @template T
 * @param {(q: (text: string, params?: unknown[]) => Promise<import("pg").QueryResult>) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const transaction = async (fn) => {
  const p = await getPool();
  if (!p) throw new Error("the database is not configured");

  const client = await p.connect();
  // Set when the rollback itself fails. The connection is then in a state
  // nobody knows -- still inside the transaction, or dead -- and returned to
  // the pool the next request to draw it would inherit that. Passed to
  // `release`, it tells `pg` to destroy the client instead.
  let broken;
  try {
    await client.query("begin");
    const result = await fn((text, params) => run(client, text, params));
    await client.query("commit");
    return result;
  } catch (e) {
    // The original error is the one worth reporting; a failed rollback on a
    // broken connection would only replace it
    await client.query("rollback").catch((rollbackError) => {
      broken = rollbackError;
    });
    throw e;
  } finally {
    client.release(broken);
  }
};
