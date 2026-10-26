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

import { DATABASE_ENV } from "../../config.mjs";
import { POOL_LIMITS } from "./url.mjs";

/** The production database. Only the Production environment may open it. */
const PRODUCTION_DATABASE = "solpg";

/**
 * @param {ReturnType<typeof import("../../../../shared/config/server-env.mjs").databaseEnv>} env
 */
export const isConfigured = (env) =>
  DATABASE_ENV["cloud-sql"].every((name) => !!env[name]);

/**
 * The connector's options for `pg`: a `stream` factory over the connector's
 * TLS socket. The one place that reaches Google; a test replaces `options`
 * with `mock.method` so no case does. Exported for tests.
 */
export const connector = {
  /**
   * @param {ReturnType<typeof import("../../../../shared/config/server-env.mjs").databaseEnv>} env
   * @returns {Promise<import("pg").PoolConfig>}
   */
  options: async (env) => {
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
    return new Connector({ auth }).getOptions({
      instanceConnectionName: env.CLOUD_SQL_INSTANCE,
      // The instances have a public IP and no authorised network: only the
      // connector front end, which checks the client certificate, answers
      ipType: "PUBLIC",
      authType: "IAM",
    });
  },
};

/**
 * Build the pool, unless this deployment may not open the database it names.
 *
 * The refusal runs before anything reaches Google, so a preview pointed at
 * the production database spends nothing and leaves no trace on the
 * instance. It is one of four gates; the federation bindings, the grants on
 * `solpg`, and the preview workflows' naming are the others (see
 * `docs/cloud-sql.md`).
 *
 * @param {ReturnType<typeof import("../../../../shared/config/server-env.mjs").databaseEnv>} env
 * @returns {Promise<import("pg").Pool>}
 */
export const createPool = async (env) => {
  if (
    env.VERCEL_ENV !== "production" &&
    env.CLOUD_SQL_DATABASE === PRODUCTION_DATABASE
  ) {
    const message =
      `refusing database "${PRODUCTION_DATABASE}" outside production ` +
      `(VERCEL_ENV is ${env.VERCEL_ENV ?? "unset"})`;
    console.error(`db: ${message}`);
    throw new Error(message);
  }

  const options = await connector.options(env);
  return new pg.Pool({
    ...options,
    user: env.CLOUD_SQL_USER,
    database: env.CLOUD_SQL_DATABASE,
    ...POOL_LIMITS,
  });
};
