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
    const start = /^ {2}([a-z][a-z-]*):$/.exec(line);
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
  /secrets\.|github\.token|id-token:\s*write|pull-requests:\s*write/;

for (const name of ["keys", "build"]) {
  test(`job ${name}, which runs the PR's code, is given no credential`, () => {
    assert.doesNotMatch(code(name), CREDENTIAL);
    assert.match(code(name), /persist-credentials: false/);
  });
}

test("job build checks its environment for credentials first", () => {
  const steps = code("build").split("- ");
  assert.match(steps[1], /No credential in the environment/);
});

for (const name of ["prepare", "deploy"]) {
  test(`job ${name}, which holds the Vercel token, never installs or builds the PR`, () => {
    const block = code(name);
    assert.match(block, /secrets\.VERCEL_TOKEN/);
    assert.doesNotMatch(
      block,
      /\byarn\b|npm (ci|install)|vercel-install|vercel-build|"\$cli" build|submodules: true|setup-node/
    );
    // Non-cone: no root file of the PR, such as an .npmrc, reaches npx
    assert.match(block, /sparse-checkout-cone-mode: false/);
  });
}

test("job database holds no Vercel token and no GitHub write access", () => {
  assert.doesNotMatch(
    code("database"),
    /secrets\.VERCEL_TOKEN\b(?! != '')|github\.token|pull-requests:\s*write/
  );
});

test("the Vercel CLI the token jobs run is checked to be vercel@x.y.z", () => {
  for (const name of ["prepare", "deploy"]) {
    assert.match(code(name), /\^vercel@\[0-9\]\+/, name);
  }
});
