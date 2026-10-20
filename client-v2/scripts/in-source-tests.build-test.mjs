// webpack drops the `import.meta.vitest` blocks by its own evaluation of `import.meta` (client-v2/AGENTS.md,
// "Tests: a module's unit tests live in the module"); if that stops, the build stays green and ships the tests
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { blockFiles, blockTitles } from "./in-source-titles.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const CHUNKS = path.join(ROOT, "build", "static", "js");
// 595 double-quoted titles at the time of writing (table-driven and template-literal titles are not counted);
// a parser that stopped matching would collect far fewer, a normal day never
const MIN_TITLES = 500;
// A short title ("does not repeat") can match product copy; a longer one matches only a shipped test
const MIN_TITLE_LENGTH = 24;

const chunkFiles = async () => {
  const entries = await fs
    .readdir(CHUNKS, { recursive: true, withFileTypes: true })
    .catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => path.join(e.parentPath, e.name));
};

test("built chunks hold no in-source test title", async () => {
  const chunks = await chunkFiles();
  assert.notEqual(
    chunks.length,
    0,
    `no .js files under ${CHUNKS}: run yarn build-fast first`
  );

  const modules = await blockFiles(ROOT);
  assert.notEqual(
    modules.length,
    0,
    "no module under src holds an in-source block"
  );
  const titles = [];
  for (const module of modules) {
    for (const title of blockTitles(
      await fs.readFile(path.join(ROOT, module), "utf8")
    )) {
      titles.push({ module, title });
    }
  }
  assert.ok(
    titles.length >= MIN_TITLES,
    `collected ${titles.length} titles, fewer than ${MIN_TITLES}`
  );

  const shipped = [];
  for (const chunk of chunks) {
    const text = await fs.readFile(chunk, "utf8");
    for (const { module, title } of titles) {
      if (title.length >= MIN_TITLE_LENGTH && text.includes(title)) {
        shipped.push(`${path.basename(chunk)} holds "${title}" from ${module}`);
      }
    }
  }
  assert.deepEqual(
    shipped,
    [],
    "built chunks hold in-source tests: webpack no longer drops the import.meta.vitest blocks"
  );
});
