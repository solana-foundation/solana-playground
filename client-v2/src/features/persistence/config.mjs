// The variables each database provider needs, shared by the providers under
// `model/providers/`, sign-in's `missingConfig`, and the build check in
// `scripts/check-agent-env.mjs`. `.mjs` and free of imports so that script can
// load it without `pg` or the pool, as it loads `features/auth/config.mjs`.

/**
 * Every variable a provider needs, keyed by the `DB_PROVIDER` value naming it.
 * One missing leaves that provider unconfigured.
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
 * Which of the chosen provider's variables are absent, by name. A
 * `DB_PROVIDER` that names no provider is itself the missing setting.
 *
 * @param {(name: string) => boolean} isSet how the caller counts a variable
 * as set: the functions treat `""` as unset, a local `vercel build` does not
 * @returns {string[]} empty when the provider has everything it needs
 */
export const missingDatabaseEnv = (isSet) => {
  const provider = process.env.DB_PROVIDER || "url";
  if (!Object.hasOwn(DATABASE_ENV, provider)) return ["DB_PROVIDER"];
  return DATABASE_ENV[provider].filter((name) => !isSet(name));
};
