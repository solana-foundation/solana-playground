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

  const options = await connector.options(env);
  return new pg.Pool({
    ...options,
    user: env.CLOUD_SQL_USER,
    database: env.CLOUD_SQL_DATABASE,
    ...POOL_LIMITS,
  });
};
