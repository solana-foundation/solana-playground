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
  /secrets[.[]|secrets: inherit|toJSON\(\s*secrets|github\.token|[a-z-]+:\s*write\b|write-all/i;

// What only the PR's dependencies and build need: none of it may meet a credential
const INSTALL_OR_BUILD =
  /\b(yarn|pnpm|bun|make)\b|\bnpm (ci|i|install)\b|vercel-install|vercel-build|"\$\{?cli\}?" build|submodules: true|setup-node/i;

// A value, not `secrets.VERCEL_TOKEN != ''`, which gives a job only whether it is set
const holdsVercelToken = (name) =>
  /secrets[.[]['"]?VERCEL_TOKEN\b(?!['"]?\]?\s*!=)/.test(code(name));

test("gives no credential to every job at once", () => {
  const top = text.slice(0, text.indexOf("\njobs:\n"));
  assert.doesNotMatch(top, CREDENTIAL);
  assert.match(top, /^permissions: \{\}$/m);
});

for (const name of ["keys", "build"]) {
  test(`gives no credential to job ${name}, which runs the PR's dependencies`, () => {
    assert.doesNotMatch(code(name), CREDENTIAL);
    assert.match(code(name), /persist-credentials: false/);
  });
}

test("makes job build check its environment for credentials first", () => {
  const steps = code("build").split(/\n\s+- (?:name|uses):/);
  assert.match(steps[1], /No credential in the environment/);
});

test("gives the Vercel token only to prepare and deploy", () => {
  assert.deepEqual([...jobs.keys()].filter(holdsVercelToken).sort(), [
    "deploy",
    "prepare",
  ]);
});

for (const name of ["database", "prepare", "deploy", "report"]) {
  test(`keeps job ${name}, which holds a credential, from installing or building the PR`, () => {
    assert.doesNotMatch(code(name), INSTALL_OR_BUILD);
  });
}

test("gives no credential to any job that installs or builds", () => {
  for (const [name] of jobs) {
    if (INSTALL_OR_BUILD.test(code(name)))
      assert.doesNotMatch(code(name), CREDENTIAL, name);
  }
});

for (const name of ["prepare", "deploy"]) {
  test(`checks out no root file in job ${name}, so no .npmrc reaches npx`, () => {
    const block = code(name);
    assert.match(block, /sparse-checkout-cone-mode: false/);
    // Only the workflow's own scripts and the CLI's version, never client-v2
    const paths = [...block.matchAll(/^\s+(\/[^\s]+)$/gm)].map(([, p]) => p);
    assert.ok(paths.length > 0, "no sparse-checkout paths");
    for (const p of paths)
      assert.match(
        p,
        /^\/(\.github\/scripts\/|client-v2\/Makefile\.vercel$)/,
        p
      );
  });

  test(`runs npx in job ${name} only after checking the CLI is vercel@x.y.z`, () => {
    const block = code(name);
    const check = block.indexOf("^vercel@[0-9]+");
    assert.ok(check >= 0, "no check of the CLI's name");
    assert.ok(check < block.indexOf("npx "), "npx runs before the check");
  });
}

test("checks the build output in job deploy before it deploys", () => {
  const block = code("deploy");
  const check = block.indexOf("preview-check-output.mjs");
  assert.ok(check >= 0);
  // A failed check must fail the step
  assert.doesNotMatch(block, /preview-check-output\.mjs[^\n]*(\|\||;|&)/);
  assert.ok(check < block.indexOf(" deploy --prebuilt"));
});

test("holds the concurrency group for the run as a whole, and gives unrelated runs one of their own", () => {
  const top = text.slice(0, text.indexOf("\njobs:\n"));
  assert.match(
    top,
    /^concurrency:\n {2}group: >-[\s\S]*preview-\{0\}[\s\S]*\|\| github\.run_id \}\}\n {2}cancel-in-progress: true$/m
  );
  for (const [name] of jobs)
    assert.doesNotMatch(code(name), /^ {4}concurrency:/m, name);
});

test("uploads only what preview-build-env.mjs wrote in job prepare, never the pulled file", () => {
  const block = code("prepare");
  assert.match(
    block,
    /preview-build-env\.mjs \.vercel\/\.env\.preview\.local inputs\//
  );
  assert.doesNotMatch(block, /cp [^\n]*\.env\.preview\.local/);
  assert.match(block, /name: preview-inputs\n\s+path: inputs\n/);
});

test("refuses climbing paths and hard links in job deploy before unpacking", () => {
  const block = code("deploy");
  const unpack = block.indexOf("tar -xzf");
  for (const check of ["climbing=", "grep -q '^h'"]) {
    const at = block.indexOf(check);
    assert.ok(at >= 0 && at < unpack, check);
  }
});
