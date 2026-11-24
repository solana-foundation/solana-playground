// .github/scripts/preview-build-env.mjs, which writes the env file a labelled
// PR's preview is built with (preview.yml, job `build`). Lives here because
// `yarn test-api` collects only client-v2's tests. Values are made up.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildEnv,
  PLACEHOLDER,
  publicSecrets,
} from "../../.github/scripts/preview-build-env.mjs";

const SCRIPT = fileURLToPath(
  new URL("../../.github/scripts/preview-build-env.mjs", import.meta.url)
);

const PULLED = `# Created by Vercel CLI
REACT_APP_SENTRY_DSN="https://abc@o1.ingest.example.io/2"
REACT_APP_SERVER_URL="https://build.example.com"
VERCEL="1"
VERCEL_ENV="preview"
VERCEL_TARGET_ENV="preview"
VERCEL_GIT_COMMIT_SHA=""
VERCEL_OIDC_TOKEN="eyJmade.up.token"
VERCEL_URL=""
DB_PROVIDER="cloud-sql"
NODE_OPTIONS="--max-old-space-size=4096"
SENTRY_PREVIEW_ENABLED="true"
SOURCEMAPS_PREVIEW_ENABLED="true"
PUBLIC_ENV_RESTRICTED_KEYS="REACT_APP_INTERNAL"
PG_AI_API_KEY="sk-made-up-key"
BETTER_AUTH_SECRET="made-up-secret"
SENTRY_AUTH_TOKEN="sntrys_made_up"
AUTH_GITHUB_CLIENT_SECRET=""
SOURCES="[{\\"name\\":\\"x\\"}]"
`;

test("keeps public names verbatim", () => {
  const out = buildEnv(PULLED);
  for (const line of [
    'REACT_APP_SENTRY_DSN="https://abc@o1.ingest.example.io/2"',
    'REACT_APP_SERVER_URL="https://build.example.com"',
    'VERCEL="1"',
    'VERCEL_ENV="preview"',
    'VERCEL_TARGET_ENV="preview"',
    'VERCEL_GIT_COMMIT_SHA=""',
    'DB_PROVIDER="cloud-sql"',
    'NODE_OPTIONS="--max-old-space-size=4096"',
    'SENTRY_PREVIEW_ENABLED="true"',
    'SOURCEMAPS_PREVIEW_ENABLED="true"',
    'PUBLIC_ENV_RESTRICTED_KEYS="REACT_APP_INTERNAL"',
  ]) {
    assert.ok(out.split("\n").includes(line), `missing ${line}`);
  }
});

test("replaces every other non-empty value with the placeholder, keeping the name", () => {
  const lines = buildEnv(PULLED).split("\n");
  for (const name of ["PG_AI_API_KEY", "BETTER_AUTH_SECRET"]) {
    assert.ok(lines.includes(`${name}="${PLACEHOLDER}"`), name);
  }
});

test("keeps an empty non-public value empty, so the build still sees it as unset", () => {
  const lines = buildEnv(PULLED).split("\n");
  assert.ok(lines.includes('AUTH_GITHUB_CLIENT_SECRET=""'));
  assert.ok(lines.includes('VERCEL_URL=""'));
});

test("drops the OIDC token, SOURCES, the Sentry token and comments", () => {
  const out = buildEnv(PULLED);
  assert.doesNotMatch(
    out,
    /VERCEL_OIDC_TOKEN|SOURCES|SENTRY_AUTH_TOKEN|Created by/
  );
});

test("finds a public value equal to a secret one", () => {
  assert.deepEqual(publicSecrets(PULLED), []);
  assert.deepEqual(
    publicSecrets(
      'REACT_APP_KEY="sk-made-up"\nPG_AI_API_KEY="sk-made-up"\nREACT_APP_EMPTY=""\nX=""\n'
    ),
    ["REACT_APP_KEY = PG_AI_API_KEY"]
  );
});

test("the CLI refuses a pulled file whose public value is a secret", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "preview-build-env-"));
  const input = path.join(dir, "in");
  writeFileSync(input, 'REACT_APP_X="s3cret"\nAPI_KEY="s3cret"\n');
  const run = spawnSync(
    process.execPath,
    [SCRIPT, input, path.join(dir, "out")],
    {
      encoding: "utf8",
    }
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /REACT_APP_X = API_KEY/);
});

test("no secret value survives", () => {
  const out = buildEnv(PULLED);
  for (const value of [
    "sk-made-up-key",
    "made-up-secret",
    "sntrys_made_up",
    "eyJmade.up.token",
  ]) {
    assert.ok(!out.includes(value), value);
  }
});

test("a name that only starts like a public one is not public", () => {
  assert.equal(
    buildEnv('VERCEL_TOKEN="t"\nVERCEL_ENVIRONMENT="x"\nREACT_APPX="y"\n'),
    `VERCEL_TOKEN="${PLACEHOLDER}"\nVERCEL_ENVIRONMENT="${PLACEHOLDER}"\nREACT_APPX="${PLACEHOLDER}"\n`
  );
});

test("the CLI writes the filtered file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "preview-build-env-"));
  const input = path.join(dir, "in");
  const output = path.join(dir, "out");
  writeFileSync(input, PULLED);
  execFileSync(process.execPath, [SCRIPT, input, output]);
  assert.equal(readFileSync(output, "utf8"), buildEnv(PULLED));
});
