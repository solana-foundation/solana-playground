import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  addedLines,
  envValuesUnder,
  findEnvLeaks,
} from "./check-env-leaks.mjs";

const DIFF = [
  "diff --git a/client-v2/a.test.mjs b/client-v2/a.test.mjs",
  "--- a/client-v2/a.test.mjs",
  "+++ b/client-v2/a.test.mjs",
  "@@ -10,0 +11,2 @@",
  '+const url = "https://made-up-1x2y3z.example.com";',
  '+const level = "warn";',
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

test("reads the added lines of a diff with their new line numbers", () => {
  assert.deepEqual(addedLines(DIFF), [
    {
      file: "client-v2/a.test.mjs",
      line: 11,
      text: 'const url = "https://made-up-1x2y3z.example.com";',
    },
    { file: "client-v2/a.test.mjs", line: 12, text: 'const level = "warn";' },
  ]);
});

test("names the line, the variable and the env file of a leaked value", () => {
  assert.deepEqual(
    findEnvLeaks(() => false, [VALUE], addedLines(DIFF)),
    [
      "client-v2/a.test.mjs:11 holds the value of REACT_APP_DEVNET_RPC_URL from .vercel/.env.production.local",
    ]
  );
});

test("passes a value the tracked tree already holds", () => {
  assert.deepEqual(
    findEnvLeaks(() => true, [VALUE], addedLines(DIFF)),
    []
  );
});

test("never prints the value itself", () => {
  const [leak] = findEnvLeaks(() => false, [VALUE], addedLines(DIFF));
  assert.ok(!leak.includes(VALUE.value));
});

test("reads every .env file but .env.example, skipping short values and placeholders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "env-leaks-"));
  try {
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
