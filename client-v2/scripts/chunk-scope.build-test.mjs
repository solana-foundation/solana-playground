// Runs after a production build (`yarn test-build`): it guards what ships, which chunk-scope.test.mjs cannot see
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { topLevelName } from "./top-level-declaration.mjs";

const CHUNKS = path.join(import.meta.dirname, "..", "build", "static", "js");

test("built chunks declare nothing at their top level", async () => {
  const entries = await fs.readdir(CHUNKS, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => path.join(e.parentPath, e.name));
  assert.notEqual(files.length, 0, `no .js files under ${CHUNKS}`);

  const declaring = [];
  for (const file of files) {
    const name = topLevelName(await fs.readFile(file, "utf8"), file);
    if (name) declaring.push(`${path.basename(file)} declares \`${name}\``);
  }
  assert.deepEqual(
    declaring,
    [],
    "built chunks declare at the top level: the minifier's iife wrapper is missing (esbuild-minify.mjs)"
  );
});
