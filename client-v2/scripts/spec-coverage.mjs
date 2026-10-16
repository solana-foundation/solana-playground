/**
 * Which OpenSpec scenarios have neither a browser test nor a `(manual)` mark.
 *
 * The convention (client-v2/CLAUDE.md, "Scenarios are the test plan"): every
 * `#### Scenario: <name>` in a spec is either a Playwright test in `e2e/`
 * titled `<capability>: <name>`, where `<capability>` is the folder the
 * `spec.md` sits in, or a scenario checked by hand and marked `(manual)` at
 * the end of its heading. This prints every scenario that is neither.
 *
 * Specs come from `openspec/specs/` and from every active change under
 * `openspec/changes/` (`archive/` is skipped: those deltas are already in
 * `specs/`). Scenarios under a `## REMOVED` heading of a delta are not owed
 * a test. Test titles are read from the source of `e2e/` as the first
 * double-quoted argument of `test(` or `test.only(` -- Prettier writes
 * titles that way, and the convention is a literal string. A `test.skip` or
 * `test.fixme` is not counted: a quarantined scenario is still uncovered.
 *
 *   yarn spec:coverage            # report, exit 0
 *   yarn spec:coverage --strict   # exit 1 when a scenario is uncovered
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const SCENARIO = /^#### Scenario: (.+)$/;
const MANUAL = / \(manual\)$/i;
const REMOVED = /^## REMOVED\b/;
const SECTION = /^## /;
const TEST_TITLE = /\btest(?:\.only)?\(\s*"([^"]*)"/g;

/** `#### Scenario:` headings of one spec file, with the `(manual)` mark read off */
export const extractScenarios = (markdown, capability, file = "") => {
  const out = [];
  let removed = false;
  markdown.split("\n").forEach((line, i) => {
    if (SECTION.test(line)) removed = REMOVED.test(line);
    const m = SCENARIO.exec(line.trimEnd());
    if (!m || removed) return;
    const name = m[1].trim();
    out.push({
      capability,
      name: name.replace(MANUAL, ""),
      manual: MANUAL.test(name),
      file,
      line: i + 1,
    });
  });
  return out;
};

/** Titles of every `test(` and `test.only(` in a Playwright source file */
export const extractTestTitles = (source) =>
  Array.from(source.matchAll(TEST_TITLE), (m) => m[1]);

/** Scenarios that are neither tested under their `<capability>: <name>` title nor manual */
export const uncovered = (scenarios, titles) => {
  const have = new Set(titles);
  return scenarios.filter(
    (s) => !s.manual && !have.has(`${s.capability}: ${s.name}`)
  );
};

const walk = async (dir, pick, skip = () => false) => {
  const found = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return found;
    throw e;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip(full)) found.push(...(await walk(full, pick, skip)));
    } else if (pick(full)) {
      found.push(full);
    }
  }
  return found;
};

/**
 * Every scenario under `openspec/specs` and the active changes, one per
 * `<capability>: <name>` -- a scenario a delta modifies is also in `specs/`,
 * and is owed one test, not two.
 */
export const readScenarios = async (openspecDir) => {
  const isSpec = (f) => f.endsWith("spec.md");
  const files = [
    ...(await walk(path.join(openspecDir, "specs"), isSpec)),
    ...(await walk(
      path.join(openspecDir, "changes"),
      isSpec,
      (d) => path.basename(d) === "archive"
    )),
  ];
  const seen = new Map();
  for (const file of files) {
    const capability = path.basename(path.dirname(file));
    const markdown = await fs.readFile(file, "utf8");
    const rel = path.relative(openspecDir, file);
    for (const s of extractScenarios(markdown, capability, rel)) {
      const key = `${s.capability}: ${s.name}`;
      if (!seen.has(key)) seen.set(key, s);
    }
  }
  return Array.from(seen.values());
};

export const readTestTitles = async (e2eDir) => {
  const files = await walk(e2eDir, (f) => f.endsWith(".ts"));
  const titles = [];
  for (const file of files) {
    titles.push(...extractTestTitles(await fs.readFile(file, "utf8")));
  }
  return titles;
};

export const report = (scenarios, titles) => {
  const missing = uncovered(scenarios, titles);
  const manual = scenarios.filter((s) => s.manual).length;
  const tested = scenarios.length - manual - missing.length;
  const lines = missing.map(
    (s) => `  ${s.capability}: ${s.name}    (${s.file}:${s.line})`
  );
  lines.push(
    `${scenarios.length} scenarios: ${tested} tested, ${manual} manual, ${missing.length} uncovered`
  );
  return { missing, text: lines.join("\n") };
};

const main = async () => {
  const clientDir = path.resolve(fileURLToPath(import.meta.url), "..", "..");
  const openspecDir = path.join(clientDir, "..", "openspec");
  try {
    await fs.access(openspecDir);
  } catch {
    console.error(`spec:coverage: no ${openspecDir}`);
    process.exit(2);
  }
  const scenarios = await readScenarios(openspecDir);
  const titles = await readTestTitles(path.join(clientDir, "e2e"));
  const { missing, text } = report(scenarios, titles);
  if (missing.length) {
    console.log("Scenarios with neither a test nor a (manual) mark:");
  }
  console.log(text);
  if (missing.length && process.argv.includes("--strict")) process.exit(1);
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
