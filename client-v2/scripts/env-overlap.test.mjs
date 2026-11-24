import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { overlap, parseEnv } from "./env-overlap.mjs";

const script = fileURLToPath(new URL("./env-overlap.mjs", import.meta.url));

test("parses dotenv lines, quotes and comments", () => {
  assert.deepEqual(
    parseEnv(
      "# comment\nA=1\nexport B=\"two words\"\nC='x=y'\n\nD=\nE = spaced\n"
    ),
    { A: "1", B: "two words", C: "x=y", D: "", E: "spaced" }
  );
});

test("names a value both sides hold, under the same name", () => {
  assert.deepEqual(
    overlap(
      { GITHUB_CLIENT_SECRET: "gh-shared-secret" },
      { GITHUB_CLIENT_SECRET: "gh-shared-secret" }
    ),
    [["GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"]]
  );
});

// The proxy secret on a preview equal to production's AUTH_SECRET would let a
// preview's holder sign production's cookies
test("names a value both sides hold under different names", () => {
  assert.deepEqual(
    overlap(
      { AUTH_OAUTH_PROXY_SECRET: "one-secret-value" },
      { AUTH_SECRET: "one-secret-value" }
    ),
    [["AUTH_OAUTH_PROXY_SECRET", "AUTH_SECRET"]]
  );
});

test("ignores public names, flags and empty values", () => {
  assert.deepEqual(
    overlap(
      {
        REACT_APP_SERVER_URL: "https://api.solpg.io",
        VERCEL_GIT_REPO_SLUG: "solana-playground",
        SYNC_ENABLED: "true",
        DEBUG: "0",
        GITHUB_CLIENT_SECRET: "",
      },
      {
        REACT_APP_SERVER_URL: "https://api.solpg.io",
        VERCEL_GIT_REPO_SLUG: "solana-playground",
        SYNC_ENABLED: "true",
        DEBUG: "0",
        GITHUB_CLIENT_SECRET: "",
      }
    ),
    []
  );
});

test("ignores the names given with --allow", () => {
  assert.deepEqual(
    overlap(
      { PG_BUILD_SERVER_URL: "https://build.example" },
      { PG_BUILD_SERVER_URL: "https://build.example" },
      new Set(["PG_BUILD_SERVER_URL"])
    ),
    []
  );
});

const files = (a, b) => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-overlap-"));
  const [pa, pb] = [path.join(dir, "a.env"), path.join(dir, "b.env")];
  writeFileSync(pa, a);
  writeFileSync(pb, b);
  return [pa, pb];
};

test("exits 1 naming the overlap, never the value", () => {
  const res = spawnSync(
    process.execPath,
    [script, ...files("X_KEY=s3cr3t-value\n", "Y_KEY=s3cr3t-value\n")],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 1);
  assert.match(res.stdout + res.stderr, /X_KEY.*Y_KEY/);
  assert.doesNotMatch(res.stdout + res.stderr, /s3cr3t/);
});

test("exits 0 when nothing overlaps, counting empty values", () => {
  const res = spawnSync(
    process.execPath,
    [script, ...files("A=one-value\nB=\n", "A=other-value\n")],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 0);
  assert.match(res.stdout, /1 empty/);
});

test("--allow takes a comma-separated list", () => {
  const res = spawnSync(
    process.execPath,
    [
      script,
      "--allow",
      "URL_A,URL_B",
      ...files("URL_A=https://x.example\n", "URL_A=https://x.example\n"),
    ],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 0);
});
