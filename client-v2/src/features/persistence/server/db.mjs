/**
 * The one Postgres entry point for every API route.
 *
 * Plain `pg` against a pooled connection string, deliberately: the target
 * instance is client-managed and its flavour is not confirmed, so nothing here
 * may depend on a vendor driver. `max` is small because a serverless platform
 * runs many instances -- the real pooling happens in front of the database,
 * not here.
 */
import pg from "pg";

let pool = null;

/** Whether a connection string is present at all */
export const isConfigured = () => !!process.env.DATABASE_URL;

/** Whether sync should serve traffic. The kill switch is opt-in. */
export const isEnabled = () =>
  isConfigured() && process.env.SYNC_ENABLED === "true";

/**
 * The shared pool, created on first use.
 *
 * @returns {import("pg").Pool | null} the pool, or `null` when no connection
 * string is configured
 */
export const getPool = () => {
  if (!isConfigured()) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Encrypted and verified unless the connection string says otherwise.
      //
      // node-postgres connects in the clear when the URL mentions no
      // `sslmode`, where dbmate refuses -- so the same URL that a migration
      // rejects would have been used by the app to send credentials in
      // plaintext, silently. Production is the case that matters, and a URL
      // there will be pasted from a provider's dashboard with no thought about
      // this flag, so the default has to be the safe one.
      //
      // A `sslmode` in the URL overrides this, which is how the local and CI
      // containers -- which serve no TLS at all -- opt out with
      // `?sslmode=disable`. `rejectUnauthorized` rather than bare `true`
      // because unverified TLS is the footgun this is meant to close: a
      // provider needing a looser mode says so in its URL, where it is visible.
      ssl: { rejectUnauthorized: true },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    // Without a listener, an error on an idle client is an unhandled 'error'
    // event, which takes the whole function down rather than the one query
    pool.on("error", () => {});
  }
  return pool;
};

/**
 * Run one statement.
 *
 * @param {string} text SQL with `$1`-style placeholders
 * @param {unknown[]} [params] bound values
 */
export const query = async (text, params) => {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not configured");
  return p.query(text, params);
};
