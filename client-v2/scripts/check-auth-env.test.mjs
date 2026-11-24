import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-auth-env.mjs", import.meta.url));

/** The check run under exactly `env`, nothing inherited */
const run = (env) =>
  spawnSync(process.execPath, [script], { env, encoding: "utf8" });

const PROXY_SECRET = "proxy-secret-value-1";
const STAGING = "https://playground-signin.vercel.app";

// Each case's environment is written out in full: client-v2/AGENTS.md, "Tests:
// no spread for creating new shapes"

test("passes production with no proxy variable", () => {
  const res = run({ VERCEL_ENV: "production", AUTH_SECRET: "prod-secret" });
  assert.equal(res.status, 0);
});

test("fails production holding the proxy secret without the host flag", () => {
  const res = run({
    VERCEL_ENV: "production",
    AUTH_SECRET: "prod-secret",
    AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_SECRET/);
  assert.doesNotMatch(res.stderr, new RegExp(PROXY_SECRET));
});

test("fails production holding a proxy URL", () => {
  const res = run({
    VERCEL_ENV: "production",
    AUTH_SECRET: "prod-secret",
    AUTH_OAUTH_PROXY_URL: STAGING,
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_URL/);
});

test("passes the staging host: flag and secret, no URL", () => {
  const res = run({
    VERCEL_ENV: "production",
    AUTH_SECRET: "staging-secret",
    AUTH_OAUTH_PROXY_HOST: "true",
    AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
  });
  assert.equal(res.status, 0);
});

test("fails the host holding a proxy URL", () => {
  const res = run({
    VERCEL_ENV: "production",
    AUTH_SECRET: "staging-secret",
    AUTH_OAUTH_PROXY_HOST: "true",
    AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
    AUTH_OAUTH_PROXY_URL: STAGING,
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_URL/);
});

test("fails the host flag without the secret", () => {
  const res = run({
    VERCEL_ENV: "production",
    AUTH_SECRET: "staging-secret",
    AUTH_OAUTH_PROXY_HOST: "true",
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_SECRET/);
});

test("fails a host flag that is not exactly true", () => {
  const res = run({
    VERCEL_ENV: "production",
    AUTH_SECRET: "prod-secret",
    AUTH_OAUTH_PROXY_HOST: "yes",
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_HOST/);
});

test("passes a preview proxying to the staging host", () => {
  const res = run({
    VERCEL_ENV: "preview",
    AUTH_SECRET: "preview-secret",
    AUTH_OAUTH_PROXY_URL: STAGING,
    AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
  });
  assert.equal(res.status, 0);
});

test("fails a preview carrying the host flag", () => {
  const res = run({
    VERCEL_ENV: "preview",
    AUTH_SECRET: "preview-secret",
    AUTH_OAUTH_PROXY_URL: STAGING,
    AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
    AUTH_OAUTH_PROXY_HOST: "true",
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_HOST/);
});

// Without the URL the preview sends GitHub its own callback, which the
// staging app's OAuth app rejects with nothing said here
test("fails a preview holding the secret without the URL", () => {
  const res = run({
    VERCEL_ENV: "preview",
    AUTH_SECRET: "preview-secret",
    AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_OAUTH_PROXY_URL/);
});

test("fails a preview whose AUTH_SECRET is the proxy secret", () => {
  const res = run({
    VERCEL_ENV: "preview",
    AUTH_SECRET: PROXY_SECRET,
    AUTH_OAUTH_PROXY_URL: STAGING,
    AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_SECRET/);
  assert.doesNotMatch(res.stderr, new RegExp(PROXY_SECRET));
});

test("fails the host whose AUTH_SECRET is the proxy secret", () => {
  const res = run({
    VERCEL_ENV: "production",
    AUTH_SECRET: PROXY_SECRET,
    AUTH_OAUTH_PROXY_HOST: "true",
    AUTH_OAUTH_PROXY_SECRET: PROXY_SECRET,
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /AUTH_SECRET/);
  assert.doesNotMatch(res.stderr, new RegExp(PROXY_SECRET));
});

// A local `vercel pull` delivers a Sensitive variable as ""
test("treats an empty value as unset", () => {
  const res = run({
    VERCEL_ENV: "production",
    AUTH_SECRET: "prod-secret",
    AUTH_OAUTH_PROXY_SECRET: "",
  });
  assert.equal(res.status, 0);
});
