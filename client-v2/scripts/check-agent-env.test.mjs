import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-agent-env.mjs", import.meta.url));

/** Exit code of the check under exactly `env`, nothing inherited; `undefined` values stay unset */
const exitCode = (env) =>
  spawnSync(process.execPath, [script], { env, encoding: "utf8" }).status;

/**
 * A build's environment. `ci` marks Vercel's own build machine; `signIn` fills
 * every sign-in variable, `""` as a local `vercel pull` delivers a Secret.
 */
const build = ({ ci, target, key, signIn, authSecret, baseUrl }) => ({
  CI: ci,
  VERCEL_ENV: target,
  AGENT_API_KEY: key,
  DATABASE_URL: signIn,
  GITHUB_CLIENT_ID: signIn,
  GITHUB_CLIENT_SECRET: signIn,
  AUTH_SECRET: authSecret ?? signIn,
  AUTH_BASE_URL: baseUrl,
});

const ORIGIN = "https://beta.solpg.io";

for (const [label, env, expected] of [
  ["fails when the key is absent", {}, 1],
  [
    "passes an empty key on a local build, as a pulled Secret arrives",
    build({ key: "", signIn: "" }),
    0,
  ],
  ["passes a key with sign-in", build({ key: "k", signIn: "" }), 0],
  [
    "fails an empty key on Vercel's build machine",
    build({ ci: "1", target: "preview", key: "", signIn: "s" }),
    1,
  ],
  [
    "fails a production key without one of sign-in's variables",
    {
      VERCEL_ENV: "production",
      AGENT_API_KEY: "k",
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
  // A preview may run without sign-in; GET /api/agent then reports no backend
  [
    "passes a preview key without sign-in",
    { VERCEL_ENV: "preview", AGENT_API_KEY: "k" },
    0,
  ],
]) {
  test(`check-agent-env ${label}`, () => {
    assert.equal(exitCode(env), expected);
  });
}
