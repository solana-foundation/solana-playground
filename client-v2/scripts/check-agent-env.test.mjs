import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-agent-env.mjs", import.meta.url));

/** The check run under exactly `env`, nothing inherited; `undefined` values stay unset */
const run = (env) =>
  spawnSync(process.execPath, [script], { env, encoding: "utf8" });

/** Exit code of the check under exactly `env` */
const exitCode = (env) => run(env).status;

/**
 * A build's environment. `ci` marks Vercel's own build machine; `signIn` fills
 * every sign-in variable, `""` as a local `vercel pull` delivers a Secret.
 */
const build = ({ ci, target, key, signIn, authSecret, baseUrl, sources }) => ({
  CI: ci,
  VERCEL_ENV: target,
  PG_AI_API_KEY: key,
  DATABASE_URL: signIn,
  GITHUB_CLIENT_ID: signIn,
  GITHUB_CLIENT_SECRET: signIn,
  AUTH_SECRET: authSecret ?? signIn,
  AUTH_BASE_URL: baseUrl,
  SOURCES: sources,
});

const ORIGIN = "https://beta.solpg.io";

/**
 * A production build on Vercel's machine with sign-in through the `cloud-sql`
 * provider and no DATABASE_URL; `omit` leaves one variable unset
 */
const cloudSqlProduction = ({ provider = "cloud-sql", omit }) => {
  const env = {
    CI: "1",
    VERCEL_ENV: "production",
    AGENT_API_KEY: "k",
    DB_PROVIDER: provider,
    CLOUD_SQL_INSTANCE: "p:r:solpg",
    CLOUD_SQL_DATABASE: "solpg",
    CLOUD_SQL_USER: "vercel-production@p.iam",
    GCP_PROJECT_NUMBER: "1",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
    GCP_SERVICE_ACCOUNT_EMAIL: "vercel-production@p.iam.gserviceaccount.com",
    GITHUB_CLIENT_ID: "s",
    GITHUB_CLIENT_SECRET: "s",
    AUTH_SECRET: "s",
    AUTH_BASE_URL: ORIGIN,
  };
  if (omit) delete env[omit];
  return env;
};

for (const [label, env, expected] of [
  ["fails when the key is absent", {}, 1],
  [
    "passes an empty key on a local build, as a pulled Secret arrives",
    build({ key: "", signIn: "" }),
    0,
  ],
  ["passes a key with sign-in", build({ key: "k", signIn: "" }), 0],
  [
    "fails a SOURCES that is not JSON",
    build({ key: "k", signIn: "", sources: "[{" }),
    1,
  ],
  [
    "fails an empty key on Vercel's build machine",
    build({ ci: "1", target: "preview", key: "", signIn: "s" }),
    1,
  ],
  [
    "fails a production key without one of sign-in's variables",
    {
      VERCEL_ENV: "production",
      PG_AI_API_KEY: "k",
      DATABASE_URL: "",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
      AUTH_BASE_URL: ORIGIN,
    },
    1,
  ],
  [
    "fails a production key with an empty sign-in variable on Vercel's build machine",
    build({
      ci: "1",
      target: "production",
      key: "k",
      signIn: "s",
      authSecret: "",
      baseUrl: ORIGIN,
    }),
    1,
  ],
  [
    "fails a production key without AUTH_BASE_URL",
    build({ target: "production", key: "k", signIn: "s" }),
    1,
  ],
  [
    "fails a production key with an AUTH_BASE_URL that is not a URL",
    build({
      target: "production",
      key: "k",
      signIn: "s",
      baseUrl: "beta.solpg.io",
    }),
    1,
  ],
  [
    "passes a production key with sign-in and AUTH_BASE_URL on Vercel's build machine",
    build({
      ci: "1",
      target: "production",
      key: "k",
      signIn: "s",
      baseUrl: ORIGIN,
    }),
    0,
  ],
  // Only the database is absent, so nothing else can be why it fails
  [
    "fails a production key on the default url provider without DATABASE_URL",
    {
      CI: "1",
      VERCEL_ENV: "production",
      AGENT_API_KEY: "k",
      GITHUB_CLIENT_ID: "s",
      GITHUB_CLIENT_SECRET: "s",
      AUTH_SECRET: "s",
      AUTH_BASE_URL: ORIGIN,
    },
    1,
  ],
  // Production on Cloud SQL carries no DATABASE_URL, and must still build
  [
    "passes a production key on Cloud SQL without DATABASE_URL",
    cloudSqlProduction({}),
    0,
  ],
  [
    "fails a production key on Cloud SQL without one of its variables",
    cloudSqlProduction({ omit: "CLOUD_SQL_USER" }),
    1,
  ],
  [
    "fails a production key whose DB_PROVIDER names no provider",
    cloudSqlProduction({ provider: "cloudsql" }),
    1,
  ],
  // A preview may run without sign-in; GET /api/agent then reports no backend
  [
    "passes a preview key without sign-in",
    { VERCEL_ENV: "preview", PG_AI_API_KEY: "k" },
    0,
  ],
]) {
  test(`check-agent-env ${label}`, () => {
    assert.equal(exitCode(env), expected);
  });
}

test("check-agent-env passes an old AGENT_API_KEY on Vercel, warning it is deprecated", () => {
  const { status, stderr } = run({
    CI: "1",
    VERCEL_ENV: "preview",
    AGENT_API_KEY: "k",
    DATABASE_URL: "s",
    GITHUB_CLIENT_ID: "s",
    GITHUB_CLIENT_SECRET: "s",
    AUTH_SECRET: "s",
  });
  assert.equal(status, 0);
  assert.match(stderr, /deprecated AGENT_\* names still set: AGENT_API_KEY\b/);
});

test("check-agent-env fails with the new name when no key is set", () => {
  const { status, stderr } = run({ CI: "1", VERCEL_ENV: "preview" });
  assert.equal(status, 1);
  assert.match(stderr, /PG_AI_API_KEY is unset or empty/);
});

test("check-agent-env does not fall back from an empty PG_AI_API_KEY on Vercel", () => {
  const { status } = run({
    CI: "1",
    VERCEL_ENV: "preview",
    PG_AI_API_KEY: "",
    AGENT_API_KEY: "k",
  });
  assert.equal(status, 1);
});

test("check-agent-env lists every old AGENT_ name still set", () => {
  const { status, stderr } = run({
    CI: "1",
    VERCEL_ENV: "preview",
    PG_AI_API_KEY: "k",
    AGENT_MODEL: "m",
    AGENT_NEWCOMER_API_KEY: "n",
  });
  assert.equal(status, 0);
  assert.match(
    stderr,
    /AGENT_NEWCOMER_API_KEY, AGENT_MODEL|AGENT_MODEL, AGENT_NEWCOMER_API_KEY/
  );
});

test("check-agent-env prefers PG_AI_API_KEY and is quiet without old names", () => {
  const { status, stderr } = run({
    CI: "1",
    VERCEL_ENV: "preview",
    PG_AI_API_KEY: "k",
    DATABASE_URL: "s",
    GITHUB_CLIENT_ID: "s",
    GITHUB_CLIENT_SECRET: "s",
    AUTH_SECRET: "s",
  });
  assert.equal(status, 0);
  assert.doesNotMatch(stderr, /AGENT_/);
});

test("check-agent-env names PG_AI_API_KEY when only an empty old key is set", () => {
  const { status, stderr } = run({
    CI: "1",
    VERCEL_ENV: "preview",
    AGENT_API_KEY: "",
  });
  assert.equal(status, 1);
  assert.match(stderr, /Set PG_AI_API_KEY/);
});
