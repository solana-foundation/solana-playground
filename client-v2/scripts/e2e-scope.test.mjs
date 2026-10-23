import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { fullSuiteRefusal, isFullSuite } from "./e2e-scope.mjs";

const cwd = "/wt/client-v2";
const testDir = path.join(cwd, "e2e");
const full = (...args) => isFullSuite(["test", ...args], { cwd, testDir });
const withLastRun = (files, args, env = {}) =>
  isFullSuite(["test", ...args], {
    cwd,
    testDir,
    env,
    exists: (file) => files.includes(file),
  });

test("a bare run is the full suite", () => {
  assert.equal(full(), true);
});

test("a spec path narrows the run", () => {
  assert.equal(full("e2e/sync.e2e.spec.ts"), false);
  assert.equal(full("e2e/sync.e2e.spec.ts:42"), false);
  assert.equal(full("sync"), false);
});

test("the test directory or anything above it is the full suite", () => {
  for (const arg of ["e2e", "e2e/", "./e2e", testDir, ".", cwd, "/wt"]) {
    assert.equal(full(arg), true, arg);
  }
});

test("a flag's value is not taken for a spec", () => {
  assert.equal(full("--project", "chromium"), true);
  assert.equal(full("-c", "my.config.mts"), true);
  assert.equal(full("-j", "1", "--reporter", "list"), true);
  assert.equal(full("--reporter=list", "--workers=1"), true);
  assert.equal(full("-c", "my.config.mts", "e2e/a.e2e.spec.ts"), false);
  assert.equal(full("--headed", "e2e/a.e2e.spec.ts"), false);
});

test("an optional value is taken only when it is one of the flag's choices", () => {
  assert.equal(full("-u", "all"), true);
  assert.equal(full("--debug", "cli"), true);
  assert.equal(full("-u", "e2e/a.e2e.spec.ts"), false);
});

test("one filter that matches every spec makes the run full", () => {
  assert.equal(full(".", "e2e/a.e2e.spec.ts"), true);
  assert.equal(full("e2e/a.e2e.spec.ts", "e2e"), true);
});

test("--grep, -g, --only-changed, --test-list and --ui narrow the run", () => {
  assert.equal(full("--grep", "sync"), false);
  assert.equal(full("--grep=sync"), false);
  assert.equal(full("-g", "sync"), false);
  assert.equal(full("-gsync"), false);
  assert.equal(full("--test-list", "list.txt"), false);
  assert.equal(full("--ui"), false);
  assert.equal(full("--only-changed"), false);
  assert.equal(full("--only-changed=origin/new-face"), false);
});

test("a short option's attached value is not taken for a spec", () => {
  assert.equal(full("-j1"), true);
  assert.equal(full("-cmy.config.mts", "e2e/a.e2e.spec.ts"), false);
});

test("--project takes every word up to the next option", () => {
  assert.equal(full("--project", "a", "b"), true);
  assert.equal(full("--project", "a", "--headed", "e2e/a.e2e.spec.ts"), false);
});

test("--shard still runs a large part of the suite", () => {
  assert.equal(full("--shard", "1/2"), true);
});

test("--last-failed narrows only when the last run's record exists", () => {
  const record = path.join(cwd, "test-results", ".last-run.json");
  assert.equal(withLastRun([], ["--last-failed"]), true);
  assert.equal(withLastRun([record], ["--last-failed"]), false);
  const moved = path.join(cwd, "out", ".last-run.json");
  assert.equal(
    withLastRun([moved], ["--last-failed", "--output", "out"]),
    false
  );
  assert.equal(withLastRun([moved], ["--last-failed", "--output=out"]), false);
  const named = path.join(cwd, "runs.json");
  assert.equal(
    withLastRun([named], ["--last-failed", "--last-failed-file", "runs.json"]),
    false
  );
  assert.equal(
    withLastRun([named], ["--last-failed"], {
      PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: "runs.json",
    }),
    false
  );
});

test("--grep-invert alone still runs nearly everything", () => {
  assert.equal(full("--grep-invert", "sync"), true);
  assert.equal(full("-G", "sync"), true);
});

test("everything after -- is a spec", () => {
  assert.equal(full("--", "e2e/a.e2e.spec.ts"), false);
});

test("a command other than test is not a suite run", () => {
  assert.equal(isFullSuite(["show-report"], { cwd, testDir }), false);
  assert.equal(isFullSuite([], { cwd, testDir }), false);
});

test("fullSuiteRefusal: the full suite is refused unless E2E_FULL=1", () => {
  const args = ["test"];
  const refusal = fullSuiteRefusal({ args, env: {}, cwd, testDir });
  assert.match(refusal, /yarn test-e2e e2e\/<spec>\.e2e\.spec\.ts/);
  assert.match(refusal, /E2E_FULL=1/);
  assert.equal(
    fullSuiteRefusal({ args, env: { E2E_FULL: "1" }, cwd, testDir }),
    null
  );
  assert.equal(
    fullSuiteRefusal({
      args: ["test", "e2e/a.e2e.spec.ts"],
      env: {},
      cwd,
      testDir,
    }),
    null
  );
});
