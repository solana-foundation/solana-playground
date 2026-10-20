// A dropped or narrowed `includeSource` in vitest.config.ts removes the in-source tests and keeps the suite green
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { blockFiles, isTestFile } from "./in-source-titles.mjs";

const ROOT = path.join(import.meta.dirname, "..");

test("vitest collects every in-source block", async () => {
  const { stdout } = await promisify(execFile)(
    path.join(ROOT, "node_modules", ".bin", "vitest"),
    ["list", "--json"],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }
  );
  const listed = new Set(
    JSON.parse(stdout)
      .map((entry) => path.relative(ROOT, entry.file).split(path.sep).join("/"))
      .filter((file) => !isTestFile(file))
  );
  const expected = await blockFiles(ROOT);

  const missing = expected.filter((file) => !listed.has(file));
  const unguarded = [...listed]
    .filter((file) => !expected.includes(file))
    .sort();
  assert.deepEqual(
    { missing, unguarded },
    { missing: [], unguarded: [] },
    "missing: modules with a block that vitest does not list (includeSource in vitest.config.ts); unguarded: listed modules without the guard"
  );
});
