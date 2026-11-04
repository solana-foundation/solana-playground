// The variables each database provider needs, shared by the pool in
// `model/db.mjs`, sign-in's `missingConfig`, and the build check in
// `scripts/check-agent-env.mjs`. `.mjs` and free of `pg` and the pool so that
// script can load it, as it loads `features/auth/config.mjs`: its one import,
// `server-env.mjs`, imports nothing.
import { databaseEnv } from "../../shared/config/server-env.mjs";

/**
 * Every variable a provider needs, keyed by the `DB_PROVIDER` value naming it.
 * One missing leaves that provider unconfigured. Its keys are the provider
 * names: `model/db.mjs` refuses to load with a module for any other name, or
 * without one for any of these.
 */
export const DATABASE_ENV = {
  url: ["DATABASE_URL"],
  "cloud-sql": [
    "CLOUD_SQL_INSTANCE",
    "CLOUD_SQL_DATABASE",
    "CLOUD_SQL_USER",
    "GCP_PROJECT_NUMBER",
    "GCP_WORKLOAD_IDENTITY_POOL_ID",
    "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
    "GCP_SERVICE_ACCOUNT_EMAIL",
  ],
};

/**
 * Whether `name` is a provider. `Object.hasOwn` so `constructor` and the like
 * are not.
 *
 * @param {string} name a `DB_PROVIDER` value
 */
export const isDatabaseProvider = (name) => Object.hasOwn(DATABASE_ENV, name);

/**
 * Which of the chosen provider's variables are absent, by name. A
 * `DB_PROVIDER` that names no provider is itself the missing setting. The
 * provider is the one `databaseEnv()` resolves, default included, so the
 * build check judges the provider the runtime opens.
 *
 * @param {(name: string) => boolean} isSet how the caller counts a variable
 * as set: the functions treat `""` as unset, a local `vercel build` does not
 * @returns {string[]} empty when the provider has everything it needs
 */
export const missingDatabaseEnv = (isSet) => {
  const provider = databaseEnv().DB_PROVIDER;
  if (!isDatabaseProvider(provider)) return ["DB_PROVIDER"];
  return DATABASE_ENV[provider].filter((name) => !isSet(name));
};
