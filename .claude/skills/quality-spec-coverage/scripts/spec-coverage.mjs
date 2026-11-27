/**
 * Gates every scenario of `openspec/specs/` on a test titled `<capability>: <scenario>`, a `(manual)` mark, or a line
 * in `excluded.txt`; the rules are the `scenario-tests` spec (openspec/changes/scenario-tests/specs/scenario-tests/spec.md).
 *
 *   yarn spec:coverage                     # exit 1 on a gap outside excluded.txt or a stale line
 *   yarn spec:coverage --base <ref>        # also exit 1 on a line <ref>'s excluded.txt lacks
 *   yarn spec:coverage --strict            # ignore excluded.txt: exit 1 on any uncovered scenario
 *   yarn spec:coverage --update-excluded   # rewrite excluded.txt from the unmet scenarios
 */
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { promisify } from "util";

const SCENARIO = /^#### Scenario: (.+)$/;
const MANUAL = / \(manual\)$/i;
const REMOVED = /^## REMOVED\b/;
const SECTION = /^## /;
// `.skip`, `.fixme`, and `.todo` never match: a quarantined scenario is still uncovered
const TEST_TITLE =
  /(?<![\w.$])(?:test\.describe|test|it|describe)(?:\.only)?\(\s*"([^"]*)"/g;
// The `include` globs of client-v2/vitest.config.ts; in-source blocks cite no scenario
const VITEST_FILE =
  /(?:\/__tests__\/.*|\.(?:spec|test))\.(?:js|jsx|ts|tsx|mts)$/;
const SKIPPED_DIRS = new Set(["node_modules", "build"]);

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

/** Literal double-quoted titles of `test`, `test.describe`, `it`, and `describe`, and their `.only` forms */
export const extractTestTitles = (source) =>
  Array.from(source.matchAll(TEST_TITLE), (m) => m[1]);

/** The keys of `excluded.txt`, without comment lines, blank lines, or trailing spaces */
export const parseExcluded = (text) =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("#"));

/**
 * Sorts scenarios by the exclude list: `missing` and `covered` scenarios and `unknown` and `duplicate` lines fail the
 * run; `reported` scenarios, which only an active change names, do not.
 */
export const gate = (scenarios, titles, excluded) => {
  const have = new Set(titles);
  const listed = new Set(excluded);
  const owed = scenarios.filter((s) => s.gated && !s.manual);
  const owedKeys = new Set(owed.map(keyOf));
  return {
    missing: owed.filter((s) => !have.has(keyOf(s)) && !listed.has(keyOf(s))),
    covered: [...listed].filter((k) => owedKeys.has(k) && have.has(k)),
    unknown: [...listed].filter((k) => !owedKeys.has(k)),
    duplicate: [
      ...new Set(excluded.filter((k, i) => excluded.indexOf(k) !== i)),
    ],
    reported: scenarios.filter(
      (s) => !s.gated && !s.manual && !have.has(keyOf(s))
    ),
  };
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
      if (!SKIPPED_DIRS.has(entry.name) && !skip(full)) {
        found.push(...(await walk(full, pick, skip)));
      }
    } else if (pick(full)) {
      found.push(full);
    }
  }
  return found;
};

export const keyOf = (s) => `${s.capability}: ${s.name}`;

/**
 * Every scenario under `openspec/specs` and the active changes, once per key; `gated` marks one read from `specs/`.
 * A scenario a delta modifies is also in `specs/`, and is owed one test, not two.
 */
export const readScenarios = async (openspecDir) => {
  const isSpec = (f) => f.endsWith("spec.md");
  const sources = [
    [await walk(path.join(openspecDir, "specs"), isSpec), true],
    [
      await walk(
        path.join(openspecDir, "changes"),
        isSpec,
        (d) => path.basename(d) === "archive"
      ),
      false,
    ],
  ];
  const seen = new Map();
  for (const [files, gated] of sources) {
    for (const file of files) {
      const capability = path.basename(path.dirname(file));
      const markdown = await fs.readFile(file, "utf8");
      const rel = path.relative(openspecDir, file);
      for (const s of extractScenarios(markdown, capability, rel)) {
        if (!seen.has(keyOf(s))) seen.set(keyOf(s), { ...s, gated });
      }
    }
  }
  return Array.from(seen.values());
};

const isNodeTest = (f) => f.endsWith(".test.mjs");

/** Titles from `e2e/`, the vitest files, and the `*.test.mjs` files `yarn test-api` runs */
export const readTestTitles = async (clientDir) => {
  const at = (rel) => path.join(clientDir, rel);
  const skills = path.join(clientDir, "..", ".claude", "skills");
  const files = [
    ...(await walk(at("e2e"), (f) => f.endsWith(".ts"))),
    ...(await walk(at("src"), (f) => VITEST_FILE.test(f) || isNodeTest(f))),
    ...(await walk(at("api"), isNodeTest)),
    ...(await walk(at("scripts"), isNodeTest)),
    ...(await walk(clientDir, isNodeTest, () => true)),
    ...(await walk(
      skills,
      (f) => isNodeTest(f) && path.basename(path.dirname(f)) === "scripts",
      (d) =>
        path.dirname(d) !== skills && path.dirname(path.dirname(d)) !== skills
    )),
  ];
  const titles = [];
  for (const file of files) {
    titles.push(...extractTestTitles(await fs.readFile(file, "utf8")));
  }
  return titles;
};

const EXCLUDED_PATH = ".claude/skills/quality-spec-coverage/excluded.txt";

/** Lines of `head` the base branch's list lacks; a base branch without the file adds none */
export const addedLines = (base, head) => {
  if (base === undefined) return [];
  const had = new Set(base);
  return head.filter((k) => !had.has(k));
};

/** The exclude list at `ref` in the repository at `repoDir`; `undefined` when `ref` has no such file */
export const readBaseExcluded = async (repoDir, ref) => {
  const git = (...args) =>
    promisify(execFile)("git", args, { cwd: repoDir, maxBuffer: 16 << 20 });
  // ls-tree prints nothing for a missing path and fails on a bad ref, as bundle-info-report.sh relies on
  const { stdout: listed } = await git(
    "ls-tree",
    "--full-tree",
    "--name-only",
    ref,
    "--",
    EXCLUDED_PATH
  );
  if (!listed.trim()) return undefined;
  const { stdout } = await git("show", `${ref}:${EXCLUDED_PATH}`);
  return parseExcluded(stdout);
};

const EXCLUDED_HEADER = `# Scenarios of openspec/specs/ not yet up to standard, one \`<capability>: <scenario>\` per line.
# The list only shrinks: a new scenario needs a test or the \`(manual)\` mark, not a line here.
# Remove a line once its scenario has a test; \`make quality-spec-coverage-update\` rewrites the list.
`;

const located = (s) => `${keyOf(s)}    (${s.file}:${s.line})`;

const section = (heading, lines) =>
  lines.length ? [heading, ...lines.map((l) => `  ${l}`), ""] : [];

const summary = (scenarios, titles, excluded) => {
  const have = new Set(titles);
  const manual = scenarios.filter((s) => s.manual).length;
  const tested = scenarios.filter((s) => !s.manual && have.has(keyOf(s)));
  return `${scenarios.length} scenarios: ${tested.length} tested, ${manual} manual, ${excluded.length} on the exclude list`;
};

const main = async () => {
  const args = process.argv.slice(2);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  // <root>/.claude/skills/quality-spec-coverage/scripts
  const root = path.resolve(scriptDir, "../../../..");
  const excludedFile = path.join(scriptDir, "..", "excluded.txt");
  const openspecDir = path.join(root, "openspec");
  try {
    await fs.access(openspecDir);
  } catch {
    console.error(`spec:coverage: no ${openspecDir}`);
    process.exit(2);
  }
  const scenarios = await readScenarios(openspecDir);
  const titles = await readTestTitles(path.join(root, "client-v2"));

  if (args.includes("--update-excluded")) {
    const unmet = gate(scenarios, titles, []).missing.map(keyOf).sort();
    await fs.writeFile(
      excludedFile,
      `${EXCLUDED_HEADER}${unmet.map((k) => `${k}\n`).join("")}`
    );
    console.log(
      `spec:coverage: wrote ${unmet.length} lines to ${path.relative(
        root,
        excludedFile
      )}`
    );
    return;
  }

  const strict = args.includes("--strict");
  let excluded = [];
  if (!strict) {
    try {
      excluded = parseExcluded(await fs.readFile(excludedFile, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const { missing, covered, unknown, duplicate, reported } = gate(
    scenarios,
    titles,
    excluded
  );
  const baseAt = args.indexOf("--base");
  const base = baseAt === -1 ? undefined : args[baseAt + 1];
  if (baseAt !== -1 && !base) {
    console.error("spec:coverage: --base needs a ref");
    process.exit(2);
  }
  const added =
    base && !strict
      ? addedLines(await readBaseExcluded(root, base), excluded)
      : [];
  const lines = [
    ...section(
      `Lines in excluded.txt that ${base}'s list lacks (a new gap needs a test or the (manual) mark, not a line here):`,
      added
    ),
    ...section(
      "Scenarios with no test, no (manual) mark, and no line in excluded.txt (add a test titled with the key, or the (manual) mark):",
      missing.map(located)
    ),
    ...section(
      "Lines in excluded.txt whose scenario now has a test (remove the line):",
      covered
    ),
    ...section(
      "Lines in excluded.txt that name no scenario of openspec/specs/, or a (manual) one (remove the line):",
      unknown
    ),
    ...section(
      "Lines in excluded.txt that appear more than once (remove the copies):",
      duplicate
    ),
    ...section(
      `Scenarios only an active change adds, with no test (${
        strict ? "failing under --strict" : "reported, not gated"
      }):`,
      reported.map(located)
    ),
    summary(scenarios, titles, excluded),
  ];
  console.log(lines.join("\n"));
  const failed =
    missing.length +
      covered.length +
      unknown.length +
      duplicate.length +
      added.length >
      0 ||
    (strict && reported.length > 0);
  if (failed) process.exit(1);
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
