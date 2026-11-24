// .github/scripts/preview-check-output.mjs, the check preview.yml's `deploy`
// job runs on the build output before uploading it. Lives here because
// `yarn test-api` collects only client-v2's tests.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { outputProblems } from "../../.github/scripts/preview-check-output.mjs";

const SCRIPT = fileURLToPath(
  new URL("../../.github/scripts/preview-check-output.mjs", import.meta.url)
);

/** A folder holding what `vercel build --standalone` writes, one function included */
const buildOutput = () => {
  const folder = mkdtempSync(path.join(tmpdir(), "preview-output-"));
  const func = path.join(folder, ".vercel/output/functions/api/agent.func");
  mkdirSync(func, { recursive: true });
  mkdirSync(path.join(folder, ".vercel/output/static"), { recursive: true });
  writeFileSync(path.join(folder, ".vercel/project.json"), "{}");
  writeFileSync(path.join(folder, ".vercel/output/config.json"), "{}");
  writeFileSync(path.join(folder, ".vercel/output/static/index.html"), "<p>");
  writeFileSync(path.join(func, "index.mjs"), "export default 1");
  writeFileSync(
    path.join(func, ".vc-config.json"),
    JSON.stringify({ handler: "index.mjs", runtime: "nodejs22.x" })
  );
  return folder;
};

test("accepts a standalone build output", () => {
  assert.deepEqual(outputProblems(buildOutput()), []);
});

test("accepts a link that stays inside the output", () => {
  const folder = buildOutput();
  symlinkSync(
    "../functions/api/agent.func/index.mjs",
    path.join(folder, ".vercel/output/static/agent.mjs")
  );
  assert.deepEqual(outputProblems(folder), []);
});

test("refuses a link to a runner file", () => {
  const folder = buildOutput();
  symlinkSync(
    "/proc/self/environ",
    path.join(folder, ".vercel/output/static/env.txt")
  );
  assert.deepEqual(outputProblems(folder), [
    "link out of the output: .vercel/output/static/env.txt",
  ]);
});

test("refuses a relative link that climbs out of the output", () => {
  const folder = buildOutput();
  symlinkSync(
    "../../project.json",
    path.join(folder, ".vercel/output/static/p.json")
  );
  assert.deepEqual(outputProblems(folder), [
    "link out of the output: .vercel/output/static/p.json",
  ]);
});

test("refuses entries beside .vercel/output and project.json", () => {
  const folder = buildOutput();
  writeFileSync(path.join(folder, ".vercel/.env.preview.local"), "A=1");
  writeFileSync(path.join(folder, "package.json"), "{}");
  assert.deepEqual(outputProblems(folder).sort(), [
    "unexpected entry: .vercel/.env.preview.local",
    "unexpected entry: package.json",
  ]);
});

test("refuses a function that names files outside itself", () => {
  const folder = buildOutput();
  writeFileSync(
    path.join(
      folder,
      ".vercel/output/functions/api/agent.func/.vc-config.json"
    ),
    JSON.stringify({
      handler: "index.mjs",
      filePathMap: { "node_modules/x/index.js": "node_modules/x/index.js" },
    })
  );
  assert.deepEqual(outputProblems(folder), [
    "function names files outside itself: .vercel/output/functions/api/agent.func/.vc-config.json",
  ]);
});

test("refuses a test file deployed as a function", () => {
  const folder = buildOutput();
  mkdirSync(path.join(folder, ".vercel/output/functions/api/agent.test.func"));
  assert.deepEqual(outputProblems(folder), [
    "test file deployed as a function: .vercel/output/functions/api/agent.test.func",
  ]);
});

test("refuses a folder with no build output", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "preview-output-"));
  assert.deepEqual(outputProblems(folder), ["no .vercel folder"]);
});

test("the CLI exits 1 and prints an error line per problem", () => {
  const folder = buildOutput();
  symlinkSync("/etc/passwd", path.join(folder, ".vercel/output/static/x"));
  const run = spawnSync(process.execPath, [SCRIPT, folder], {
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.equal(
    run.stdout,
    "::error::link out of the output: .vercel/output/static/x\n"
  );
  assert.equal(spawnSync(process.execPath, [SCRIPT, buildOutput()]).status, 0);
});
