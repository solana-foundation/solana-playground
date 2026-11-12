import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { addedRuns, envValuesUnder, findEnvLeaks } from "./check-env-leaks.mjs";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-env-leaks.mjs"
);

/**
 * The environment the throwaway repository's git runs in, without git's own
 * variables. A git hook (the pre-push hook runs `yarn run check`) sets
 * `GIT_DIR` and friends for its process; inherited, they point every git call
 * here at the real repository, whose shared config then got this file's test
 * identity and `core.bare=true`.
 */
const isolated = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );

const DIFF = [
  "diff --git a/client-v2/a.test.mjs b/client-v2/a.test.mjs",
  "--- a/client-v2/a.test.mjs",
  "+++ b/client-v2/a.test.mjs",
  "@@ -10,0 +11,2 @@",
  '+const url = "https://made-up-1x2y3z.example.com";',
  '+const level = "warn";',
  "@@ -20,0 +22 @@",
  "+// another run",
  "diff --git a/old.md b/old.md",
  "deleted file mode 100644",
  "--- a/old.md",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-https://made-up-1x2y3z.example.com",
].join("\n");

const VALUE = {
  name: "REACT_APP_DEVNET_RPC_URL",
  value: "https://made-up-1x2y3z.example.com",
  file: ".vercel/.env.production.local",
};

const KEY = {
  name: "PRIVATE_KEY",
  value: "-----BEGIN MADE UP KEY-----\nAbCdEf123456\n-----END MADE UP KEY-----",
  file: "client-v2/.env",
};

/** One added run of `file` starting at `line` */
const runOf = (file, line, text) => ({ file, line, text });

test("groups the added lines of a diff into runs with their new line numbers", () => {
  assert.deepEqual(addedRuns(DIFF), [
    runOf(
      "client-v2/a.test.mjs",
      11,
      'const url = "https://made-up-1x2y3z.example.com";\nconst level = "warn";'
    ),
    runOf("client-v2/a.test.mjs", 22, "// another run"),
  ]);
});

test("reads a path core.quotePath quotes", () => {
  const diff = [
    '+++ "b/docs/caf\\303\\251 notes.md"',
    "@@ -0,0 +1 @@",
    "+text",
  ].join("\n");
  assert.equal(addedRuns(diff)[0].file, "docs/café notes.md");
});

test("names the line, the variable and the env file of a leaked value", () => {
  assert.deepEqual(
    findEnvLeaks(() => false, [VALUE], addedRuns(DIFF)),
    [
      "client-v2/a.test.mjs:11 holds the value of REACT_APP_DEVNET_RPC_URL from .vercel/.env.production.local",
    ]
  );
});

test("passes a value the tracked tree already holds", () => {
  assert.deepEqual(
    findEnvLeaks(() => true, [VALUE], addedRuns(DIFF)),
    []
  );
});

test("never prints the value itself", () => {
  const [leak] = findEnvLeaks(() => false, [VALUE], addedRuns(DIFF));
  assert.ok(!leak.includes(VALUE.value));
});

test("finds a multiline value across added lines", () => {
  const runs = [runOf("k.pem", 3, `header\n${KEY.value}\nfooter`)];
  assert.deepEqual(
    findEnvLeaks(() => false, [KEY], runs),
    ["k.pem:4 holds the value of PRIVATE_KEY from client-v2/.env"]
  );
});

test("finds a multiline value written as a string literal", () => {
  const runs = [runOf("k.mjs", 1, `const k = ${JSON.stringify(KEY.value)};`)];
  assert.deepEqual(
    findEnvLeaks(() => false, [KEY], runs),
    ["k.mjs:1 holds the value of PRIVATE_KEY from client-v2/.env"]
  );
});

test("reads every .env file but .env.example, skipping short values and placeholders", () => {
  withTempDir((root) => {
    fs.mkdirSync(path.join(root, "client-v2"));
    fs.mkdirSync(path.join(root, ".vercel"));
    fs.writeFileSync(
      path.join(root, "client-v2", ".env"),
      "AUTH_SECRET=made-up-secret-1\nSYNC_ENABLED=true\n"
    );
    fs.writeFileSync(
      path.join(root, "client-v2", ".env.example"),
      "REACT_APP_SERVER_URL=https://api.example.com\n"
    );
    fs.writeFileSync(
      path.join(root, ".vercel", ".env.production.local"),
      'NEON_API_KEY="[SENSITIVE]"\nDATABASE_URL="postgres://u:made-up@h/db"\n'
    );
    assert.deepEqual(
      envValuesUnder([root])
        .map(({ name }) => name)
        .sort(),
      ["AUTH_SECRET", "DATABASE_URL"]
    );
  });
});

function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-leaks-"));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A throwaway repository with a `.env` holding a made-up secret, its first commit the base */
const withRepo = (run) =>
  withTempDir((dir) => {
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        env: isolated(),
      });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(dir, ".gitignore"), ".env\n");
    fs.writeFileSync(path.join(dir, ".env"), "AUTH_SECRET=made-up-secret-77\n");
    git("add", ".gitignore");
    git("commit", "-q", "-m", "base");
    run({ dir, git });
  });

const runCli = (dir, args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: isolated(),
  });

test("blocks a staged value even under diff.noprefix", () => {
  withRepo(({ dir, git }) => {
    git("config", "diff.noprefix", "true");
    fs.writeFileSync(path.join(dir, "a.txt"), "made-up-secret-77\n");
    git("add", "a.txt");
    const run = runCli(dir, ["--staged"]);
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /a\.txt:1 holds the value of AUTH_SECRET/);
  });
});

test("finds a value one commit adds and a later one removes", () => {
  withRepo(({ dir, git }) => {
    const base = git("rev-parse", "HEAD").trim();
    fs.writeFileSync(path.join(dir, "a.txt"), "made-up-secret-77\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "add");
    fs.writeFileSync(path.join(dir, "a.txt"), "clean\n");
    git("commit", "-q", "-am", "remove");
    const run = runCli(dir, ["--range", base]);
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /a\.txt:1 holds the value of AUTH_SECRET/);
  });
});

test("passes a range that never held a value", () => {
  withRepo(({ dir, git }) => {
    const base = git("rev-parse", "HEAD").trim();
    fs.writeFileSync(path.join(dir, "a.txt"), "clean\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "clean");
    assert.equal(runCli(dir, ["--range", base]).status, 0);
  });
});

test("leaves the repository a git hook names alone", () => {
  withTempDir((decoy) => {
    const gitDir = path.join(decoy, "outer.git");
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = gitDir;
    try {
      withRepo(({ git }) => {
        assert.equal(git("config", "user.name").trim(), "test");
      });
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
    assert.equal(fs.existsSync(gitDir), false);
  });
});
