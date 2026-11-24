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
   * @returns {Promise<{ stream: () => import("node:stream").Duplex; close: () => void }>}
   * the connector's socket factory, and `close`, which stops its refresh
   * timer. Sockets it already opened stay up: the connector tracks sockets
   * only for an instance reached by domain name, and ours is reached by
   * connection name
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
    const google = new Connector({ auth });
    const { stream } = await google.getOptions({
      instanceConnectionName: env.CLOUD_SQL_INSTANCE,
      // The instances have a public IP and no authorised network: only the
      // connector front end, which checks the client certificate, answers
      ipType: "PUBLIC",
      authType: "IAM",
    });
    return {
      stream: /** @type {() => import("node:stream").Duplex} */ (stream),
      close: () => google.close(),
    };
  },
};

/**
 * How long one connector serves new connections before the pool takes a fresh
 * one. Its client certificate lasts an hour, and the connector renews it on a
 * timer, which does not run while Vercel has the function frozen: an instance
 * woken after an hour connected with an expired certificate and the server
 * answered "bad certificate" (Sentry SOLANA-PLAYGROUND-G). The quarter hour
 * left is the room for a renewal that fails and is retried.
 */
export const RENEW_AFTER_MS = 45 * 60_000;

/** How long a renewal may take before the pool gives up on it */
export const RENEW_TIMEOUT_MS = 10_000;

/** How long after a failed renewal the pool tries again */
export const RENEW_RETRY_MS = 60_000;

/**
 * A `pg` pool that opens new connections through a connector younger than
 * `RENEW_AFTER_MS`. The pool itself never changes, since Better Auth keeps
 * the one it was given for the life of the instance; what changes is the
 * connector behind its `stream`. Connections already open are untouched: the
 * certificate is checked only when TLS is set up.
 *
 * The check runs in `connect()`. A client `pg-pool` creates for a queued
 * request, once a busy one frees up, skips it; with `max` at 3 that needs
 * three requests at once in the minute an instance wakes, and the connector
 * then refreshes on the failed handshake, as it did before.
 */
class ConnectorPool extends pg.Pool {
  /**
   * @param {{
   *   config: import("pg").PoolConfig;
   *   renew: () => ReturnType<typeof connector.options>;
   *   first: Awaited<ReturnType<typeof connector.options>>;
   * }} args `config` without `stream`; `renew` builds a connector; `first`
   * is the one built already
   */
  constructor({ config, renew, first }) {
    let current = first;
    let since = Date.now();
    /** No renewal is tried before this time */
    let retryAt = 0;
    super({ ...config, stream: () => current.stream() });

    /** @type {Promise<void> | undefined} */
    let renewing;
    /**
     * Swap in a fresh connector when the current one is old. A renewal that
     * fails or times out is logged and leaves the current connector in place:
     * its certificate still has the rest of the hour, and the next try comes
     * after `RENEW_RETRY_MS`, so an outage costs one attempt a minute, not one
     * per request.
     */
    this.ready = () => {
      const now = Date.now();
      if (now - since < RENEW_AFTER_MS || now < retryAt) {
        return Promise.resolve();
      }
      renewing ??= withTimeout(renew(), RENEW_TIMEOUT_MS)
        .then(
          (fresh) => {
            const old = current;
            current = fresh;
            since = Date.now();
            old.close?.();
          },
          (error) => {
            retryAt = Date.now() + RENEW_RETRY_MS;
            // eslint-disable-next-line no-console -- server-side: Vercel's function log is where this goes
            console.error("db: renewing the Cloud SQL connector failed", {
              message: /** @type {Error} */ (error).message,
            });
          }
        )
        .finally(() => {
          renewing = undefined;
        });
      return renewing;
    };
  }

  /**
   * `pg-pool` connects through a callback inside `query()`, Kysely through the
   * promise; both wait for `ready()`, which never rejects.
   *
   * @param {Parameters<import("pg").Pool["connect"]>[0]} [callback]
   */
  // @ts-expect-error -- one implementation for both of pg's overloads
  connect(callback) {
    const ready = this.ready();
    if (!callback) return ready.then(() => super.connect());
    ready.then(() => super.connect(callback));
    return undefined;
  }
}

/**
 * The connector `pending` resolves to, or a rejection after `ms`. A connector
 * that arrives after the timeout is closed, so its refresh timer does not run
 * for the life of the instance.
 *
 * @param {ReturnType<typeof connector.options>} pending
 * @param {number} ms
 */
const withTimeout = (pending, ms) => {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  let late = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      late = true;
      reject(new Error(`timed out after ${ms} ms`));
    }, ms);
  });
  return Promise.race([
    pending.then((options) => {
      if (late) options.close?.();
      return options;
    }),
    /** @type {Promise<never>} */ (timeout),
  ]).finally(() => clearTimeout(timer));
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

  const renew = () => connector.options(env);
  return new ConnectorPool({
    config: {
      user: env.CLOUD_SQL_USER,
      database: env.CLOUD_SQL_DATABASE,
      ...POOL_LIMITS,
    },
    renew,
    first: await renew(),
  });
};
