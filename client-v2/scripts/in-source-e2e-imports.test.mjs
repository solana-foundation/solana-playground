// Playwright compiles a `.ts` under a CommonJS package as CommonJS, where `import.meta` is a syntax
// error, so a module with an in-source block that `e2e/` loads, through any chain of imports, fails
// the e2e job at load; this fails first
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { relativeImports } from "./in-source-titles.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const E2E = path.join(ROOT, "e2e");
const SRC = path.join(ROOT, "src");
const SUFFIXES = ["", ".ts", ".tsx", ".mts", ".mjs", "/index.ts"];

const isFile = (file) =>
  fs.stat(file).then(
    (s) => s.isFile(),
    () => false
  );

/** The file a specifier resolves to, or `null` when no candidate exists */
const resolveImport = async (from, specifier) => {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : path.resolve(path.dirname(from), specifier);
  for (const suffix of SUFFIXES) {
    if (await isFile(base + suffix)) return base + suffix;
  }
  return null;
};

/** Every `src/` file `from` loads, directly or through its imports, with the file that first loaded each */
const loadedFrom = async (from) => {
  const loaded = new Map();
  const queue = [from];
  while (queue.length) {
    const file = queue.shift();
    for (const specifier of relativeImports(await fs.readFile(file, "utf8"))) {
      const target = await resolveImport(file, specifier);
      if (!target || !target.startsWith(SRC + path.sep)) continue;
      if (loaded.has(target)) continue;
      loaded.set(target, { specifier, by: file });
      queue.push(target);
    }
  }
  return loaded;
};

test("e2e loads no module with an in-source block", async () => {
  const entries = await fs.readdir(E2E, {
    recursive: true,
    withFileTypes: true,
  });
  const specs = entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.join(e.parentPath, e.name));
  assert.notEqual(specs.length, 0, `no .ts files under ${E2E}`);

  const blocked = [];
  for (const spec of specs) {
    for (const [file, { specifier, by }] of await loadedFrom(spec)) {
      if ((await fs.readFile(file, "utf8")).includes("import.meta.vitest")) {
        blocked.push(
          `${path.relative(ROOT, spec)} loads ${path.relative(ROOT, file)}` +
            ` (${path.relative(
              ROOT,
              by
            )} imports ${specifier}): it holds an in-source block`
        );
      }
    }
  }
  assert.deepEqual(
    blocked,
    [],
    "keep that module's tests in a <name>.test.mts file (client-v2/AGENTS.md, \"Tests: a module's unit tests live in the module\")"
  );
});
