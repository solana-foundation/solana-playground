/**
 * The `cloud-sql` provider: a pool through Google's Cloud SQL connector.
 *
 * No connection string, no password, no key. The deployment's Vercel OIDC
 * token is traded at Google's STS, through Workload Identity Federation, for
 * the service account the federation binds to this Vercel environment; the
 * connector then fetches a short-lived client certificate for it and opens a
 * TLS stream to the instance's connector front end, where IAM database
 * authentication logs in as `CLOUD_SQL_USER`.
 *
 * The Google libraries are imported on first use, so a deployment on the `url`
 * provider never loads them.
 */
import pg from "pg";

// The preview databases' prefixes, from the module that names every preview
// database, so the gate and the workflows cannot disagree on them
import {
  BRANCH_PREFIX,
  PR_PREFIX,
} from "../../../../../scripts/db/preview-name.mjs";
import { createServerLogger } from "../../../../shared/lib/logger/server.mjs";
import { POOL_LIMITS } from "./url.mjs";

/** The production instance and database. Only Production may open either. */
const PRODUCTION_INSTANCE = "solpg";
const PRODUCTION_DATABASE = "solpg";

/** The database the previews without one of their own share */
const SHARED_PREVIEW_DATABASE = "solpg_preview";

/**
 * The instance's own name, the last segment of `CLOUD_SQL_INSTANCE`, or
 * `undefined` when the value is not `<project>:<region>:<instance>`.
 *
 * @param {string} connectionName
 */
const instanceOf = (connectionName) => {
  const segments = connectionName.split(":");
  return segments.length === 3 && segments.every(Boolean)
    ? segments[2]
    : undefined;
};

/**
 * Whether `name` is a preview database: the shared one, or one that
 * `scripts/db/preview-name.mjs` names for a PR or a branch.
 *
 * @param {string} name
 */
const isPreviewDatabase = (name) =>
  name === SHARED_PREVIEW_DATABASE ||
  [PR_PREFIX, BRANCH_PREFIX].some(
    (prefix) => name.startsWith(prefix) && name.length > prefix.length
  );

/**
 * Why this deployment may not open the instance and database it names, or
 * `undefined` when it may. Decided on both together: Production opens the
 * production instance's production database and nothing else, and every
 * other environment (a preview, a laptop, CI) stays off the production
 * instance and opens only a preview database.
 *
 * @param {ReturnType<typeof import("../../../../shared/config/server-env.mjs").databaseEnv>} env
 * @returns {string | undefined}
 */
const refusalOf = (env) => {
  const instance = instanceOf(env.CLOUD_SQL_INSTANCE ?? "");
  const database = env.CLOUD_SQL_DATABASE ?? "";
  const where = `(VERCEL_ENV is ${env.VERCEL_ENV ?? "unset"})`;
  if (!instance) {
    return `refusing instance "${env.CLOUD_SQL_INSTANCE}": not <project>:<region>:<instance> ${where}`;
  }
  if (env.VERCEL_ENV === "production") {
    if (instance !== PRODUCTION_INSTANCE) {
      return `refusing instance "${instance}" in production ${where}`;
    }
    if (database !== PRODUCTION_DATABASE) {
      return `refusing database "${database}" in production ${where}`;
    }
    return undefined;
  }
  if (instance === PRODUCTION_INSTANCE) {
    return `refusing instance "${instance}" outside production ${where}`;
  }
  if (!isPreviewDatabase(database)) {
    return `refusing database "${database}" outside production: not a preview database ${where}`;
  }
  return undefined;
};

/**
 * @typedef {{ stream: () => import("node:stream").Duplex; close: () => void }} Link
 * One connector, ready to open sockets: `stream` opens a TLS socket to the
 * instance with the connector's current client certificate, `close` stops its
 * refresh timer.
 */

/**
 * How long one connector opens new sockets before the pool replaces it.
 *
 * The connector's client certificate lasts an hour, and a background timer
 * renews it. Vercel freezes a function between requests, so the timer does
 * not run while it is frozen: an instance woken after the hour opens its
 * socket with the expired certificate, and the Cloud SQL front end refuses it
 * with TLS alert 42, "bad certificate" (HOO-2956). The connector renews only
 * after that failure, and no version up to 1.13.1 (the latest, November
 * 2026) has an option to renew on use. So
 * the pool takes a new connector, with a new certificate, before it opens a
 * socket through one this old: 45 minutes, under the hour with room for a
 * clock skew and a slow certificate fetch.
 */
const LINK_MAX_AGE_MS = 45 * 60 * 1000;

/**
 * The age past which a connector's certificate can no longer be trusted to
 * work, so a `connect` waits for the new connector however long it takes:
 * five minutes before the hour, the margin the connector's own refresh keeps.
 * Younger than this, the old certificate still works, and a `connect` waits
 * for the new one only `RENEWAL_WAIT_MS`.
 */
const LINK_STALE_AGE_MS = 55 * 60 * 1000;

/**
 * How long a `connect` waits for a renewal while the old connector still
 * works. Past it, the `connect` goes through the old connector and the
 * renewal carries on, to serve the `connect` after it.
 */
const RENEWAL_WAIT_MS = 2000;

/**
 * How long a connection stays open unused: the `maxDuration` of
 * `api/agent.mjs` in `vercel.json`, so the connection a turn's reserve used is
 * still open for its settle. A new connection through the connector can take
 * longer than `connectionTimeoutMillis`, and a settle that cannot connect
 * leaves the turn's reservation held (HOO-2996). Each connection stays open
 * this long after it was last released, so the database sees more of them
 * open at once than with `POOL_LIMITS`' default. `cloud-sql.test.mjs` fails
 * when `maxDuration` outgrows it.
 */
const IDLE_TIMEOUT_MS = 300_000;

const log = createServerLogger("persistence:cloud-sql");

/**
 * The connector, as a `Link`. The one place that reaches Google; a test
 * replaces `open` with `mock.method` so no case does. Exported for tests.
 */
export const connector = {
  /**
   * @param {ReturnType<typeof import("../../../../shared/config/server-env.mjs").databaseEnv>} env
   * @returns {Promise<Link>}
   */
  open: async (env) => {
    const [{ Connector }, { ExternalAccountClient }, { getVercelOidcToken }] =
      await Promise.all([
        import("@google-cloud/cloud-sql-connector"),
        import("google-auth-library"),
        import("@vercel/oidc"),
      ]);
    const auth = ExternalAccountClient.fromJSON({
      type: "external_account",
      audience:
        `//iam.googleapis.com/projects/${env.GCP_PROJECT_NUMBER}` +
        `/locations/global/workloadIdentityPools/${env.GCP_WORKLOAD_IDENTITY_POOL_ID}` +
        `/providers/${env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url:
        "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/" +
        `${env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
      // Read per exchange, not once: Vercel's token is short-lived, and the
      // connector refreshes its certificate for the life of the pool. Called
      // with no arguments: the library passes its own `{ audience }`, which
      // `getVercelOidcToken` would take as a request to re-issue the token
      // for Google's audience rather than the one the federation trusts
      subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
    });
    const opened = new Connector({ auth });
    const { stream } = await opened.getOptions({
      instanceConnectionName: env.CLOUD_SQL_INSTANCE,
      // The instances have a public IP and no authorised network: only the
      // connector front end, which checks the client certificate, answers
      ipType: "PUBLIC",
      authType: "IAM",
    });
    return { stream, close: () => opened.close() };
  },
};

/**
 * @typedef {{ link: Link; openedAt: number; sockets: number; retired: boolean }} Entry
 */

/**
 * The pool's sockets, through a connector no older than `LINK_MAX_AGE_MS`.
 *
 * `stream` is `pg`'s socket factory, which `pg` calls synchronously, so it
 * cannot wait for a certificate; `renew` can, and the pool awaits it before
 * every `connect`. A replaced connector is closed once its last socket closes,
 * so no connection the pool holds loses its connector under it. When a new
 * connector cannot be had, the old one stays: its certificate may still be
 * valid, and if it is not, the connection fails as it would have anyway. The
 * next `connect` tries again. A slow renewal holds a `connect` for at most
 * `RENEWAL_WAIT_MS` until the connector reaches `LINK_STALE_AGE_MS`, since
 * `pg`'s `connectionTimeoutMillis` does not count the wait.
 *
 * @param {ReturnType<typeof import("../../../../shared/config/server-env.mjs").databaseEnv>} env
 */
const linksFor = async (env) => {
  /** @param {Link} link @returns {Entry} */
  const entryOf = (link) => ({
    link,
    openedAt: Date.now(),
    sockets: 0,
    retired: false,
  });
  /** @param {Entry} entry */
  const closeIfDone = (entry) => {
    if (entry.retired && entry.sockets === 0) entry.link.close();
  };

  let current = entryOf(await connector.open(env));
  /** @type {Promise<void> | undefined} */
  let renewal;

  /** @returns {Promise<void>} */
  const renew = () => {
    const age = Date.now() - current.openedAt;
    if (age < LINK_MAX_AGE_MS) return Promise.resolve();
    const started = startRenewal();
    if (age >= LINK_STALE_AGE_MS) return started;
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    const waited = new Promise((resolve) => {
      timer = setTimeout(resolve, RENEWAL_WAIT_MS);
    });
    return Promise.race([started, waited]).finally(() => clearTimeout(timer));
  };

  /** @returns {Promise<void>} */
  const startRenewal = () => {
    // One renewal for every `connect` that finds the connector old
    renewal ??= connector
      .open(env)
      .then(
        (link) => {
          const old = current;
          current = entryOf(link);
          old.retired = true;
          closeIfDone(old);
        },
        (error) => {
          log.error(error, {
            report: true,
            context: { op: "renew", ageMs: Date.now() - current.openedAt },
          });
        }
      )
      .finally(() => {
        renewal = undefined;
      });
    return renewal;
  };

  const stream = () => {
    const entry = current;
    const socket = entry.link.stream();
    entry.sockets += 1;
    socket.once("close", () => {
      entry.sockets -= 1;
      closeIfDone(entry);
    });
    return socket;
  };

  return { stream, renew, linkAgeMs: () => Date.now() - current.openedAt };
};

/**
 * @typedef {{
 *   idle: number;
 *   total: number;
 *   waiting: number;
 *   linkAgeMs: number;
 *   renewMs: number;
 *   connectMs: number;
 * }} ConnectContext
 * What a failed `connect` found and how long it took, as `error.connect`:
 * the pool's idle and open clients and its queued requests as it began, the connector's age,
 * the time spent waiting for a renewal, and the time `pg` spent after it.
 * `connectionTimeoutMillis` bounds `connectMs` only.
 */

/**
 * A `pg` pool that awaits `renew` before each `connect`. `pg-pool`'s `query`
 * goes through `connect` too, with a callback, so both forms wait. One pool
 * for the life of the instance: Better Auth keeps the pool it was given.
 *
 * A failed `connect` carries a `ConnectContext` as `error.connect`, which
 * reaches the route through `query`: the timeout `pg` raises says neither
 * whether a client was idle nor where the time went.
 *
 * @param {{ renew: () => Promise<void>; linkAgeMs: () => number }} links
 */
const renewingPoolWith =
  ({ renew, linkAgeMs }) =>
  /** @param {import("pg").PoolConfig} config */
  (config) =>
    new (class extends pg.Pool {
      /** @param {(error: Error | undefined, client?: import("pg").PoolClient, done?: (release?: unknown) => void) => void} [callback] */
      connect(callback) {
        const began = Date.now();
        const found = {
          idle: this.idleCount,
          total: this.totalCount,
          waiting: this.waitingCount,
          linkAgeMs: linkAgeMs(),
        };
        /** @type {number | undefined} */
        let renewed;
        /** @param {Error | undefined} error */
        const withContext = (error) => {
          if (error && typeof error === "object") {
            const now = Date.now();
            /** @type {ConnectContext} */
            const context = {
              ...found,
              renewMs: (renewed ?? now) - began,
              connectMs: renewed === undefined ? 0 : now - renewed,
            };
            Object.assign(error, { connect: context });
          }
          return error;
        };
        // `renew` never rejects: it logs a failed renewal and keeps the old connector
        const ready = renew().then(() => {
          renewed = Date.now();
        });
        if (!callback) {
          return ready
            .then(() => super.connect())
            .catch((error) => {
              throw withContext(error);
            });
        }
        void ready.then(() =>
          // eslint-disable-next-line max-params -- `pg-pool`'s connect callback defines this signature
          super.connect((error, client, done) =>
            callback(withContext(error), client, done)
          )
        );
        return undefined;
      }
    })(config);

/**
 * Build the pool, unless this deployment may not open the database it names.
 *
 * The refusal (`refusalOf`) runs before anything reaches Google, so a
 * preview pointed at the production instance spends nothing and leaves no
 * trace on it. It is one of four gates; the federation bindings, the grants on
 * `solpg`, and the preview workflows' naming are the others (see
 * `docs/cloud-sql.md`).
 *
 * @param {ReturnType<typeof import("../../../../shared/config/server-env.mjs").databaseEnv>} env
 * @returns {Promise<import("pg").Pool>}
 */
export const createPool = async (env) => {
  const refusal = refusalOf(env);
  if (refusal) {
    // eslint-disable-next-line no-console -- server-side: Vercel's function log is where this goes
    console.error(`db: ${refusal}`);
    throw new Error(refusal);
  }

  const { stream, renew, linkAgeMs } = await linksFor(env);
  return renewingPoolWith({ renew, linkAgeMs })({
    stream,
    user: env.CLOUD_SQL_USER,
    database: env.CLOUD_SQL_DATABASE,
    ...POOL_LIMITS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  });
};
