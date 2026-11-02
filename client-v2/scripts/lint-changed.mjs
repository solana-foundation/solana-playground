// Shows a change its own lint messages; always exits 0, since `yarn lint`'s `--max-warnings` is the gate.
// Usage: node client-v2/scripts/lint-changed.mjs <repo-relative path>... | --staged | --pushed | --dirty

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLIENT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(CLIENT);

// The directories and extensions `yarn lint` covers, as repo-relative prefixes and suffixes.
const LINTED_DIRS = ["client-v2/src/", "client-v2/api/", "client-v2/e2e/"];
const LINTED_EXTENSIONS = [".ts", ".tsx", ".mjs", ".mts"];

/**
 * Whether `yarn lint` covers this repo-relative path, by directory and extension only.
 *
 * @param {string} file
 * @returns {boolean}
 */
export const isLintedPath = (file) =>
  LINTED_DIRS.some((dir) => file.startsWith(dir)) &&
  LINTED_EXTENSIONS.some((extension) => file.endsWith(extension));

/**
 * A line saying why no lint messages were checked, printed to stdout because that is the stream the Claude Code hook forwards.
 *
 * @param {string} why
 * @returns {string}
 */
export const notice = (why) =>
  `lint-changed: ${why}; lint messages not checked`;

const compareText = (a, b) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/**
 * The report for ESLint results: one `path:line:col level rule message` line per message, then one
 * `count level rule` line per level and rule, sorted. Paths under `root` are made relative to it.
 *
 * @param {string} root absolute path the printed paths are relative to
 * @returns {(results: { filePath: string, messages: { line?: number, column?: number,
 *   severity: number, ruleId: string | null, message: string }[] }[]) => string} "" when there are no messages
 */
export const formatReportFor = (root) => (results) => {
  const prefix = root + path.sep;
  const messages = results.flatMap(({ filePath, messages }) =>
    messages.map((message) => ({
      file: filePath.startsWith(prefix)
        ? filePath.slice(prefix.length)
        : filePath,
      line: message.line ?? 0,
      column: message.column ?? 0,
      level: message.severity === 2 ? "error" : "warn",
      rule: message.ruleId ?? "eslint",
      text: message.message,
    }))
  );
  const counts = new Map();
  for (const { level, rule } of messages) {
    const key = `${level} ${rule}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const groups = [...counts.keys()]
    .sort(compareText)
    .map((key) => `${counts.get(key)} ${key}`);
  return [
    ...messages.map(
      ({ file, line, column, level, rule, text }) =>
        `${file}:${line}:${column} ${level} ${rule} ${text}`
    ),
    ...groups,
  ].join("\n");
};

/**
 * The local shas of git's pre-push stdin (`<lref> <lsha> <rref> <rsha>` per line), without the all-zero
 * sha of a deleted ref.
 *
 * @param {string} stdin
 * @returns {string[]}
 */
export const parsePushedShas = (stdin) =>
  stdin
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[1] ?? "")
    .filter((sha) => /[^0]/.test(sha));

/**
 * The paths of `git status --porcelain=v1 -z` output that exist in the working tree: a rename or copy
 * gives its new path, and a deletion on either side is dropped.
 *
 * @param {string} output
 * @returns {string[]}
 */
export const parsePorcelain = (output) => {
  const fields = output.split("\0");
  const files = [];
  for (let index = 0; index < fields.length; index++) {
    const status = fields[index].slice(0, 2);
    const file = fields[index].slice(3);
    if (file === "") continue;
    // `-z` writes a rename's or a copy's original path as the next field
    if (/[RC]/.test(status)) index++;
    if (!status.includes("D")) files.push(file);
  }
  return files;
};

const reasonOf = (error) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0];

const isFile = (file) =>
  fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;

const absolute = (file) => path.join(ROOT, file);

const git = (args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

// The blob's text, or undefined for a path git cannot show at that revision or a binary blob.
const readBlob = (revision) => (file) => {
  try {
    const blob = execFileSync("git", ["show", `${revision}:${file}`], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return blob.includes(0) ? undefined : blob.toString("utf8");
  } catch {
    // A path deleted at that revision has nothing to lint, and the caller skips it
    return undefined;
  }
};

const withoutIgnored = (eslint) => async (files) => {
  const ignored = await Promise.all(
    files.map((file) => eslint.isPathIgnored(absolute(file)))
  );
  return files.filter((_, index) => !ignored[index]);
};

// Runs `lint` with an ESLint for client-v2 and reports its results, or a notice when ESLint cannot run.
const reportWith = async (lint) => {
  const loaded = await import("eslint").then(
    ({ ESLint }) => ({ ESLint }),
    (error) => ({ error })
  );
  if ("error" in loaded) {
    return notice(
      `eslint could not be imported (${reasonOf(
        loaded.error
      )}); run yarn install in client-v2`
    );
  }
  try {
    const results = await lint(new loaded.ESLint({ cwd: CLIENT }));
    return formatReportFor(ROOT)(results);
  } catch (error) {
    return notice(
      `ESLint failed (${reasonOf(
        error
      )}); run yarn lint in client-v2 for the whole error`
    );
  }
};

/**
 * The lint report for the working-tree copies of these repo-relative paths, or a {@link notice} when ESLint
 * cannot run; never throws. Paths outside `yarn lint`'s scope, missing files, and ignored files are skipped.
 *
 * @param {string[]} paths
 * @returns {Promise<string>} "" when nothing was linted or nothing was found
 */
export const lintChanged = async (paths) => {
  const files = paths.filter(
    (file) => isLintedPath(file) && isFile(absolute(file))
  );
  if (files.length === 0) return "";
  return reportWith(async (eslint) => {
    const linted = await withoutIgnored(eslint)(files);
    return linted.length === 0 ? [] : eslint.lintFiles(linted.map(absolute));
  });
};

// Lints each path's content at its git revision ("" is the index), under the path's own config.
const lintRevisions = async (revisions) => {
  const files = [...revisions.keys()].filter(isLintedPath).sort(compareText);
  if (files.length === 0) return "";
  return reportWith(async (eslint) => {
    const results = [];
    for (const file of await withoutIgnored(eslint)(files)) {
      const text = readBlob(revisions.get(file))(file);
      if (text === undefined) continue;
      results.push(
        ...(await eslint.lintText(text, { filePath: absolute(file) }))
      );
    }
    return results;
  });
};

const stagedRevisions = () =>
  new Map(
    git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
      .split("\0")
      .filter(Boolean)
      .map((file) => [file, ""])
  );

// Files changed by the pushed commits no remote has; a path two refs touch is read at the later ref in stdin.
const pushedRevisions = () => {
  const revisions = new Map();
  for (const sha of parsePushedShas(fs.readFileSync(0, "utf8"))) {
    const log = git([
      "log",
      "--name-only",
      "--format=",
      sha,
      "--not",
      "--remotes",
    ]);
    for (const file of log.split("\n").filter(Boolean)) {
      revisions.set(file, sha);
    }
  }
  return revisions;
};

const dirtyPaths = () =>
  parsePorcelain(
    git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  );

const reportFor = (args) => {
  if (args[0] === "--staged") return lintRevisions(stagedRevisions());
  if (args[0] === "--pushed") return lintRevisions(pushedRevisions());
  if (args[0] === "--dirty") return lintChanged(dirtyPaths());
  return lintChanged(args);
};

const main = async (args) => {
  try {
    const report = await reportFor(args);
    if (report !== "") console.log(report);
  } catch (error) {
    console.log(notice(`could not list the files (${reasonOf(error)})`));
  }
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main(process.argv.slice(2));
}
