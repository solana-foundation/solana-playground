// The split preview.yml rests on (HOO-2888): the jobs that run a labelled
// PR's code hold no credential, and the jobs that hold one never install or
// build the PR. Read from the workflow's text, without a YAML parser, which
// client-v2 does not depend on; a job is the block under `jobs:` that starts
// at two spaces of indent.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync(
  new URL("../../.github/workflows/preview.yml", import.meta.url),
  "utf8"
);

/** @returns {Map<string, string>} each job's name and its text */
const jobsOf = (workflow) => {
  const body = workflow.slice(workflow.indexOf("\njobs:\n"));
  const jobs = new Map();
  let name;
  for (const line of body.split("\n")) {
    const start = /^ {2}([A-Za-z_][\w-]*):$/.exec(line);
    if (start) [, name] = start;
    if (name) jobs.set(name, `${jobs.get(name) ?? ""}${line}\n`);
  }
  return jobs;
};

const jobs = jobsOf(text);
const job = (name) => {
  const block = jobs.get(name);
  assert.ok(block, `preview.yml has no job ${name}`);
  return block;
};

// Without its comments: a comment may name what the job must not do.
const code = (name) =>
  job(name)
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const CREDENTIAL =
  /secrets[.[]|toJSON\(\s*secrets|github\.token|id-token:\s*write|pull-requests:\s*write|write-all/i;

// What only the PR's dependencies and build need: none of it may meet a credential
const INSTALL_OR_BUILD =
  /\byarn\b|\bnpm (ci|i|install)\b|vercel-install|vercel-build|"\$cli" build|submodules: true|setup-node/i;

// A value, not `secrets.VERCEL_TOKEN != ''`, which gives a job only whether it is set
const holdsVercelToken = (name) =>
  /secrets[.[]['"]?VERCEL_TOKEN\b(?!['"]?\]?\s*!=)/.test(code(name));

test("the workflow gives no credential to every job at once", () => {
  const top = text.slice(0, text.indexOf("\njobs:\n"));
  assert.doesNotMatch(top, CREDENTIAL);
  assert.match(top, /^permissions: \{\}$/m);
});

for (const name of ["keys", "build"]) {
  test(`job ${name}, which runs the PR's dependencies, is given no credential`, () => {
    assert.doesNotMatch(code(name), CREDENTIAL);
    assert.match(code(name), /persist-credentials: false/);
  });
}

test("job build checks its environment for credentials first", () => {
  const steps = code("build").split(/\n\s+- (?:name|uses):/);
  assert.match(steps[1], /No credential in the environment/);
});

test("only prepare and deploy hold the Vercel token", () => {
  assert.deepEqual([...jobs.keys()].filter(holdsVercelToken).sort(), [
    "deploy",
    "prepare",
  ]);
});

for (const name of ["database", "prepare", "deploy", "report"]) {
  test(`job ${name}, which holds a credential, never installs or builds the PR`, () => {
    assert.doesNotMatch(code(name), INSTALL_OR_BUILD);
  });
}

test("every job that installs or builds holds no credential", () => {
  for (const [name] of jobs) {
    if (INSTALL_OR_BUILD.test(code(name)))
      assert.doesNotMatch(code(name), CREDENTIAL, name);
  }
});

for (const name of ["prepare", "deploy"]) {
  test(`job ${name} checks out no root file, so no .npmrc reaches npx`, () => {
    assert.match(code(name), /sparse-checkout-cone-mode: false/);
  });

  test(`job ${name} runs npx only after checking the CLI is vercel@x.y.z`, () => {
    const block = code(name);
    const check = block.indexOf("^vercel@[0-9]+");
    assert.ok(check >= 0, "no check of the CLI's name");
    assert.ok(check < block.indexOf("npx "), "npx runs before the check");
  });
}

test("job deploy checks the build output before it deploys", () => {
  const block = code("deploy");
  const check = block.indexOf("preview-check-output.mjs");
  assert.ok(check >= 0);
  assert.ok(check < block.indexOf(" deploy --prebuilt"));
});
