// Tells a local run of the whole e2e suite from a run of a few specs. Three
// full suites at once ran a laptop out of memory; a session needs only the
// specs it touched, and the full suite is CI's. `playwright.config.mts` refuses
// a local full suite unless `E2E_FULL=1`.

import fs from "node:fs";
import path from "node:path";

// `playwright test` options that take a value, so the word after one is not a
// spec (Playwright 1.62, `playwright test --help`).
const VALUE_FLAGS = new Set([
  "--browser",
  "-c",
  "--config",
  "-g",
  "--grep",
  "-G",
  "--grep-invert",
  "--global-timeout",
  "-j",
  "--workers",
  "--last-failed-file",
  "--max-failures",
  "--output",
  "--project",
  "--repeat-each",
  "--reporter",
  "--retries",
  "--run-agents",
  "--shard",
  "--test-list",
  "--test-list-invert",
  "--timeout",
  "--trace",
  "--tsconfig",
  "--ui-host",
  "--ui-port",
  "--update-source-method",
]);

// `--project <name...>` takes every word up to the next option.
const VARIADIC_FLAGS = new Set(["--project"]);

// Options whose value is optional: the next word is theirs only when it is
// one of their choices. `--only-changed [ref]` is left out: it narrows the run
// whatever follows it.
const OPTIONAL_VALUE_FLAGS = new Map([
  ["--debug", new Set(["inspector", "cli"])],
  ["-u", new Set(["all", "changed", "missing", "none"])],
  ["--update-snapshots", new Set(["all", "changed", "missing", "none"])],
]);

// Each picks some tests, or none until the user does (`--ui`). `--shard` is
// not here: half the suite is still most of it.
const NARROWING_FLAGS = new Set([
  "-g",
  "--grep",
  "--only-changed",
  "--test-list",
  "--ui",
]);

// Without the last run's record, `--last-failed` runs everything.
const lastRunFile = (values, { cwd, testDir, env }) => {
  if (values.has("--last-failed-file")) {
    return path.resolve(cwd, values.get("--last-failed-file"));
  }
  if (env.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE) {
    return path.resolve(cwd, env.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE);
  }
  const output = values.get("--output");
  const outputDir =
    output === undefined
      ? path.join(path.dirname(testDir), "test-results")
      : path.resolve(cwd, output);
  return path.join(outputDir, ".last-run.json");
};

const isWithin = (child, parent) => {
  const relative = path.relative(parent, child);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

/**
 * Whether `playwright test` with these arguments runs the whole suite: no
 * flag that picks tests, and no spec filter or one that matches every spec.
 * Playwright runs the union of its filters, so one naming the test directory
 * or a directory above it (`e2e/`, `.`) makes the run full whatever else is
 * named. Filters are regular expressions to Playwright, so a broad one that
 * is no directory (`spec`) still slips through: the check guards against the
 * usual mistake, not every spelling.
 *
 * @param {string[]} args `process.argv.slice(2)`: the command, then its options
 * @param {{ cwd: string, testDir: string,
 *   env?: Record<string, string | undefined>,
 *   exists?: (file: string) => boolean }} where
 *   `exists` is for a test to stand in for the filesystem
 * @returns {boolean} false for any command other than `test`
 */
export function isFullSuite(
  args,
  { cwd, testDir, env = {}, exists = fs.existsSync }
) {
  if (args[0] !== "test") return false;
  const filters = [];
  /** @type {Map<string, string>} */
  const values = new Map();
  let lastFailed = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      filters.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-")) {
      filters.push(arg);
      continue;
    }
    // `--name=value`, and a short option with its value attached (`-gsync`).
    const attached = !arg.startsWith("--") && arg.length > 2;
    const name = attached ? arg.slice(0, 2) : arg.split("=", 1)[0];
    if (NARROWING_FLAGS.has(name)) return false;
    if (name === "--last-failed") lastFailed = true;
    if (attached || arg.includes("=")) {
      values.set(name, attached ? arg.slice(2) : arg.slice(name.length + 1));
    } else if (VARIADIC_FLAGS.has(name)) {
      while (i + 1 < args.length && !args[i + 1].startsWith("-")) i++;
    } else if (VALUE_FLAGS.has(name)) {
      values.set(name, args[++i]);
    } else if (OPTIONAL_VALUE_FLAGS.get(name)?.has(args[i + 1])) {
      i++;
    }
  }
  if (lastFailed && exists(lastRunFile(values, { cwd, testDir, env }))) {
    return false;
  }
  return (
    filters.length === 0 ||
    filters.some((filter) => isWithin(testDir, path.resolve(cwd, filter)))
  );
}

/**
 * The message a local full-suite run exits with, or null when the run may go
 * on: it names specs, or `E2E_FULL=1` asks for the whole suite on purpose.
 *
 * @param {{ args: string[], env: Record<string, string | undefined>,
 *   cwd: string, testDir: string }} options
 * @returns {string | null}
 */
export function fullSuiteRefusal({ args, env, cwd, testDir }) {
  if (env.E2E_FULL === "1") return null;
  if (!isFullSuite(args, { cwd, testDir, env })) return null;
  return [
    "A local e2e run takes only the specs you touched:",
    "  yarn test-e2e e2e/<spec>.e2e.spec.ts",
    "The full suite is CI's. To run it here anyway (it still waits for a",
    "queue slot): E2E_FULL=1 yarn test-e2e",
  ].join("\n");
}
