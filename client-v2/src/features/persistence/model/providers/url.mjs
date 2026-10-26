/**
 * The `url` provider: a pool over `DATABASE_URL`.
 *
 * Plain `pg` against a pooled connection string: Neon, the compose container,
 * the CI service container. `max` is small because a serverless platform runs
 * many instances -- the real pooling happens in front of the database, not
 * here.
 */
import pg from "pg";

/**
 * Per-instance pool limits, shared with every provider. A serverless platform
 * runs many instances, each with its own pool, so the instance count times
 * `max` is what the database sees.
 */
export const POOL_LIMITS = {
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
};

/**
 * @param {ReturnType<typeof import("../../../../shared/config/server-env.mjs").databaseEnv>} env
 */
export const isConfigured = (env) => !!env.DATABASE_URL;

/**
 * @param {ReturnType<typeof import("../../../../shared/config/server-env.mjs").databaseEnv>} env
 * @returns {Promise<import("pg").Pool>}
 */
export const createPool = async (env) =>
  new pg.Pool({
    connectionString: env.DATABASE_URL,
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
    ...POOL_LIMITS,
  });
