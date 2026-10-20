import fs from "node:fs/promises";
import path from "node:path";

const GUARD = "if (import.meta.vitest)";
const TEST_FILE = /\.(test|spec)\.[^/]+$|(^|\/)__tests__\//;
// `it("title"` and `it.each(table)("title"`; prettier writes titles as double-quoted literals
const TITLE = /\bit(?:\.each\([\s\S]*?\))?\(\s*"([^"\n]*)"/g;
// Value `import`/`export ... from "./x"` or `"@/x"`, and a bare `import "./x"`; `import type` is erased
// before Playwright runs the file, so it loads nothing
const RELATIVE_IMPORT =
  /^[ \t]*(?:import|export)\s+(?!type\s)[^;]*?\bfrom\s+"((?:\.\.?\/|@\/)[^"]+)"|^[ \t]*import\s+"((?:\.\.?\/|@\/)[^"]+)"/gm;

/** Whether a path under `src/` is a test file rather than a module */
export const isTestFile = (relPath) => TEST_FILE.test(relPath);

/** The double-quoted `it` titles after the first in-source guard; template-literal titles are skipped */
export const blockTitles = (text) => {
  const at = text.indexOf(GUARD);
  if (at < 0) return [];
  return Array.from(text.slice(at).matchAll(TITLE), (m) => m[1]);
};

/** The relative and `@/` specifiers a source text loads at run time, in order; type-only imports are skipped */
export const relativeImports = (text) =>
  Array.from(text.matchAll(RELATIVE_IMPORT), (m) => m[1] ?? m[2]);

/** Paths under `root`, `src/...`, of every non-test `.ts`/`.tsx` module whose text holds the guard */
export const blockFiles = async (root) => {
  const src = path.join(root, "src");
  const entries = await fs.readdir(src, {
    recursive: true,
    withFileTypes: true,
  });
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (isTestFile(rel)) continue;
    if ((await fs.readFile(file, "utf8")).includes("import.meta.vitest"))
      found.push(rel);
  }
  return found.sort();
};
