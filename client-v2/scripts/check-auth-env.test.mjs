import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-auth-env.mjs", import.meta.url));

/** The check run under exactly `env`, nothing inherited; `undefined` values stay unset */
const run = (env) =>
  spawnSync(process.execPath, [script], {
    env: Object.fromEntries(
      Object.entries(env).filter(([, value]) => value !== undefined)
    ),
    encoding: "utf8",
  });

const PROXY_SECRET = "proxy-secret-value-1";
const STAGING = "https://playground-signin.vercel.app";

const production = (extra = {}) => ({
  CI: "1",
  VERCEL_ENV: "production",
  AUTH_SECRET: "prod-auth-secret",
  ...extra,
});

const preview = (extra = {}) => ({
  CI: "1",
  VERCEL_ENV: "preview",
  AUTH_SECRET: "preview-auth-secret",
  AUTH_OAUTH_PROXY_URL: STAGING,
  AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
  ...extra,
});

test("passes production with no proxy variable", () => {
  assert.equal(run(production()).status, 0);
});

test("fails production holding the proxy secret without the host flag", () => {
  const res = run(production({ AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_SECRET/);
  assert.doesNotMatch(res.stderr, new RegExp(PROXY_SECRET));
});

test("fails production holding a proxy URL", () => {
  const res = run(production({ AUTH_OAUTH_PROXY_URL: STAGING }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_URL/);
});

test("passes the staging host: flag and secret, no URL", () => {
  const env = production({
    AUTH_OAUTH_PROXY_HOST: "true",
    AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
  });
  assert.equal(run(env).status, 0);
});

test("fails the host flag without the secret", () => {
  const res = run(production({ AUTH_OAUTH_PROXY_HOST: "true" }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_SECRET/);
});

test("fails a host flag that is not exactly true", () => {
  const res = run(production({ AUTH_OAUTH_PROXY_HOST: "yes" }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_HOST/);
});

test("passes a preview proxying to the staging host", () => {
  assert.equal(run(preview()).status, 0);
});

test("fails a preview carrying the host flag", () => {
  const res = run(preview({ AUTH_OAUTH_PROXY_HOST: "true" }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_HOST/);
});

for (const [label, env] of [
  ["a preview", preview({ AUTH_SECRET: PROXY_SECRET })],
  [
    "the host",
    production({
      AUTH_OAUTH_PROXY_HOST: "true",
      AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
      AUTH_SECRET: PROXY_SECRET,
    }),
  ],
]) {
  test(`fails ${label} whose AUTH_SECRET is the proxy secret`, () => {
    const res = run(env);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /AUTH_SECRET/);
    assert.doesNotMatch(res.stderr, new RegExp(PROXY_SECRET));
  });
}

// A local `vercel pull` delivers a Sensitive variable as ""
test("treats an empty value as unset", () => {
  assert.equal(run(production({ AUTH_OAUTH_PROXY_SECRET: "" })).status, 0);
});
