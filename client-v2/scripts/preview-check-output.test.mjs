// .github/scripts/preview-check-output.mjs, the check preview.yml's `deploy`
// job runs on the build output before uploading it. Lives here because
// `yarn test-api` collects only client-v2's tests.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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

test("refuses a chain of links that leaves the output through a folder link", () => {
  const folder = buildOutput();
  const staticDir = path.join(folder, ".vercel/output/static");
  // `d` points back at the output itself, so the kernel reads `d/../..` as
  // the folder holding .vercel, where the runner file is
  symlinkSync("..", path.join(staticDir, "d"));
  writeFileSync(path.join(folder, "runner-file"), "secret");
  symlinkSync("d/../../runner-file", path.join(staticDir, "p.json"));
  assert.deepEqual(outputProblems(folder), [
    "unexpected entry: runner-file",
    "link out of the output: .vercel/output/static/p.json",
  ]);
});

test("refuses a function config that is a link", () => {
  const folder = buildOutput();
  const func = path.join(folder, ".vercel/output/functions/api/agent.func");
  writeFileSync(path.join(func, "config.json"), "{}");
  symlinkSync("config.json", path.join(func, ".vc-config.json.tmp"));
  // An unparseable config, and a second function whose config is a link
  writeFileSync(path.join(func, ".vc-config.json"), "");
  const other = path.join(folder, ".vercel/output/functions/api/b.func");
  mkdirSync(other);
  symlinkSync("../agent.func/config.json", path.join(other, ".vc-config.json"));
  assert.deepEqual(outputProblems(folder), [
    "function config is not JSON: .vercel/output/functions/api/agent.func/.vc-config.json",
    "function config is a link: .vercel/output/functions/api/b.func/.vc-config.json",
  ]);
});

test("refuses a test function that is a link", () => {
  const folder = buildOutput();
  symlinkSync(
    "agent.func",
    path.join(folder, ".vercel/output/functions/api/agent.test.func")
  );
  assert.deepEqual(outputProblems(folder), [
    "test file deployed as a function: .vercel/output/functions/api/agent.test.func",
  ]);
});

test("refuses an output folder that is a link", () => {
  const folder = buildOutput();
  const elsewhere = mkdtempSync(path.join(tmpdir(), "elsewhere-"));
  const output = path.join(folder, ".vercel/output");
  execFileSync("rm", ["-rf", output]);
  symlinkSync(elsewhere, output);
  assert.deepEqual(outputProblems(folder), ["no .vercel/output folder"]);
});

test("refuses a .vercel folder that is a link", () => {
  const folder = buildOutput();
  const vercel = path.join(folder, ".vercel");
  execFileSync("mv", [
    vercel,
    path.join(folder, "..", `${path.basename(folder)}-v`),
  ]);
  symlinkSync(path.join(folder, "..", `${path.basename(folder)}-v`), vercel);
  assert.deepEqual(outputProblems(folder), ["no .vercel folder"]);
});

test("refuses a FIFO", () => {
  const folder = buildOutput();
  execFileSync("mkfifo", [path.join(folder, ".vercel/output/static/pipe")]);
  assert.deepEqual(outputProblems(folder), [
    "not a file, folder or link: .vercel/output/static/pipe",
  ]);
});

test("judges a dangling link by its text", () => {
  const folder = buildOutput();
  const staticDir = path.join(folder, ".vercel/output/static");
  symlinkSync("missing.html", path.join(staticDir, "in.html"));
  symlinkSync("/nowhere/missing", path.join(staticDir, "out.html"));
  assert.deepEqual(outputProblems(folder), [
    "link out of the output: .vercel/output/static/out.html",
  ]);
});

test("refuses a project.json that is not a file", () => {
  const folder = buildOutput();
  const project = path.join(folder, ".vercel/project.json");
  execFileSync("rm", [project]);
  symlinkSync("/etc/hosts", project);
  assert.deepEqual(outputProblems(folder), [
    "not a file: .vercel/project.json",
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
