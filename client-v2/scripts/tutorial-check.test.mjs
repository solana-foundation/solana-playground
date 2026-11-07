import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join("src", "tutorials", "__tests__");

/** A temporary folder, removed when the test `t` ends */
const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutorial-check-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** `yarn tutorial:check` with these arguments, as the script runs it */
const check = (...args) =>
  spawnSync(
    path.join(CLIENT, "node_modules", ".bin", "tsx"),
    ["scripts/tutorial-check.ts", ...args],
    { cwd: CLIENT, encoding: "utf8" }
  );

test("tutorial:check passes every tutorial in the repository", () => {
  const run = check();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^hello-anchor: ok$/m);
});

test("tutorial:check names a wrong option with no reason by its path", () => {
  const run = check(path.join(FIXTURES, "missing-reason"));
  assert.equal(run.status, 1);
  assert.match(
    run.stdout,
    /^steps\[1\]\.beats\[3\]\.why\[2\]: a wrong option needs a reason, found null$/m
  );
});

test("tutorial:check names the beat and the file of a block the target lacks", () => {
  const run = check(path.join(FIXTURES, "block-not-in-target"));
  assert.equal(run.status, 1);
  assert.match(
    run.stdout,
    /^steps\[1\]\.beats\[3\]\.writes\.block: a block in the step's target src\/lib\.rs, found /m
  );
});

test("tutorial:check takes a slug", () => {
  const run = check("hello-anchor");
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test("tutorial:check stops on a slug with no definition", () => {
  const run = check("no-such-tutorial");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /no-such-tutorial/);
});

test("tutorial:check reports a file that is not JSON", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "tutorial.json"), "{ not json");
  const run = check(dir);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /tutorial\.json: not JSON, /);
});

test("tutorial:check names a doc whose page is missing from docs/", (t) => {
  const dir = tempDir(t);
  const definition = JSON.parse(
    fs.readFileSync(
      path.join(CLIENT, "src", "tutorials", "hello-anchor", "tutorial.json"),
      "utf8"
    )
  );
  definition.docs = [
    {
      title: "IDL",
      url: "https://www.anchor-lang.com/docs/basics/idl",
      file: "idl.md",
    },
  ];
  fs.writeFileSync(path.join(dir, "tutorial.json"), JSON.stringify(definition));
  const run = check(dir);
  assert.equal(run.status, 1);
  assert.match(
    run.stdout,
    /^docs\[0\]\.file: a Markdown file in the tutorial's docs folder, found no "idl\.md" there$/m
  );
});
