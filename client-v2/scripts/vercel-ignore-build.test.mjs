import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The command as Vercel runs it: vercel.json's own string, from the project root
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const { ignoreCommand } = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
);

// Vercel's Ignored Build Step reads the exit code: 0 skips the build, 1 builds
const SKIP = 0;
const BUILD = 1;

/** Exit code of the step for a deployment of `ref` to `target`, nothing else inherited; `undefined` stays unset */
const exitCode = (ref, target = "preview") =>
  spawnSync("sh", ["-c", ignoreCommand], {
    cwd: projectRoot,
    env: {
      PATH: process.env.PATH,
      VERCEL_GIT_COMMIT_REF: ref,
      VERCEL_ENV: target,
    },
    encoding: "utf8",
  }).status;

test("builds production from any branch", () => {
  assert.equal(exitCode("hoo-2378-vercel-build-skip", "production"), BUILD);
});

for (const [ref, expected] of [
  ["master", BUILD],
  ["scope/interface", BUILD],
  ["scope/typescript", BUILD],
  ["new-face-polish-2", BUILD],
  ["new-face-polish-3", BUILD],
  ["hoo-2378-vercel-build-skip", SKIP],
  ["new-face-polish", SKIP],
  ["feat/scope/x", SKIP],
  ["Master", SKIP],
  ["master-2.0", SKIP],
  ["new-face-polish-2-fix", SKIP],
  // No ref, unset or empty, cannot be classified, so it builds
  [undefined, BUILD],
  ["", BUILD],
]) {
  const verb = expected === BUILD ? "builds" : "skips";
  test(`${verb} ${JSON.stringify(ref)}`, () => {
    assert.equal(exitCode(ref), expected);
  });
}
