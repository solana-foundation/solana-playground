// Fails a commit whose added lines hold a value from a local `.env*` file.
//
// The `.env*` files are gitignored, but their values are not: a fixture, a
// doc or a test copied from one carries a real URL, key or password into
// version control. This reads every `.env*` file of this checkout and of the
// main checkout (a linked worktree has none of its own), and fails when an
// added line holds one of their values that the tracked tree at the
// reference commit does not already hold, as `.env.example`'s public
// defaults are held.
//
//   node scripts/check-env-leaks.mjs --staged        # the pre-commit hook
//   node scripts/check-env-leaks.mjs --range <base>  # every commit since <base>
//
// Messages name the variable and the env file, never the value.
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { parseEnv } from "util";

import { encodedForms } from "./lib/encoded-forms.mjs";

/** Shorter values ("true", "1", "neondb") match by chance in any diff */
const MIN_LENGTH = 8;

/** What `vercel env pull` writes in place of a Sensitive value */
const PLACEHOLDERS = new Set(["[SENSITIVE]"]);

/** The folders, under a checkout's root, that hold env files */
const ENV_DIRS = [
  ".",
  "client-v2",
  ".vercel",
  path.join("client-v2", ".vercel"),
];

/** `.env`, `.env.local`, `.env.production.local`…; `.env.example` is tracked and public */
const isEnvFile = (name) =>
  /^\.env(\..+)?$/.test(name) && name !== ".env.example";

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });

/**
 * The roots to read env files under: this checkout's and the main
 * checkout's, which differ in a linked worktree.
 *
 * @param {string} cwd a folder inside the checkout
 * @returns {string[]}
 */
const checkoutRoots = (cwd) => {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  const common = path.resolve(
    cwd,
    git(cwd, ["rev-parse", "--git-common-dir"]).trim()
  );
  return [...new Set([root, path.dirname(common)])];
};

/**
 * Every value of the env files under `roots`, with the variable and the
 * file it came from.
 *
 * @param {string[]} roots checkout roots
 * @returns {Array<{ name: string, value: string, file: string }>}
 */
export const envValuesUnder = (roots) =>
  roots.flatMap((root) =>
    ENV_DIRS.map((dir) => path.join(root, dir))
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) =>
        fs
          .readdirSync(dir)
          .filter(isEnvFile)
          .map((name) => path.join(dir, name))
          .filter((file) => fs.statSync(file).isFile())
      )
      .flatMap((file) =>
        Object.entries(parseEnv(fs.readFileSync(file, "utf8"))).map(
          ([name, value]) => ({ name, value, file })
        )
      )
      .filter(
        ({ value }) => value.length >= MIN_LENGTH && !PLACEHOLDERS.has(value)
      )
  );

/**
 * The `git diff` options every diff here is read with: fixed `a/` and `b/`
 * prefixes whatever `diff.noprefix` or `diff.mnemonicPrefix` says, no rename
 * detection, no external driver, no colour, no context lines.
 */
const DIFF_OPTIONS = [
  "--no-ext-diff",
  "--no-color",
  "--no-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-U0",
];

/** The escapes git writes in a quoted path besides octal bytes */
const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/**
 * A path git wrote in C-style quotes (`"caf\303\251.md"`): octal escapes are
 * bytes of the UTF-8 name, the rest are single characters.
 */
const unquoted = (quoted) => {
  const bytes = [];
  const body = quoted.slice(1, -1);
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== "\\") {
      bytes.push(...Buffer.from(body[i]));
    } else if (/[0-7]{3}/.test(body.slice(i + 1, i + 4))) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      const next = body[i + 1];
      bytes.push(C_ESCAPES[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
};

/** The path a `+++ ` header names, quoted by `core.quotePath` or not; `""` for a deletion */
const headerPath = (header) => {
  const target = header.slice(4);
  if (target === "/dev/null") return "";
  const name = target.startsWith('"') ? unquoted(target) : target;
  return name.startsWith("b/") ? name.slice(2) : name;
};

/**
 * The added lines of a unified diff made with `DIFF_OPTIONS`, grouped into
 * runs of consecutive lines, so a value spanning lines is found too.
 *
 * @param {string} diff `git diff` output
 * @returns {Array<{ file: string, line: number, text: string }>} one entry per run, its lines joined by `\n`
 */
export const addedRuns = (diff) => {
  const runs = [];
  let file = "";
  let line = 0;
  let run;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) {
      file = headerPath(row);
      run = undefined;
    } else if (row.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(row)?.[1] ?? 0);
      run = undefined;
    } else if (row.startsWith("+") && file) {
      if (run) {
        run.text += `\n${row.slice(1)}`;
      } else {
        run = { file, line, text: row.slice(1) };
        runs.push(run);
      }
      line += 1;
    } else {
      run = undefined;
    }
  }
  return runs;
};

/**
 * Where the added runs hold an env value, as written or as a string
 * literal would write it, as `<file>:<line> holds the value of <NAME>`.
 *
 * @param {(value: string) => boolean} isKnown whether the tracked tree already holds a value
 * @param {Array<{ name: string, value: string, file: string }>} values from `envValuesUnder`
 * @param {Array<{ file: string, line: number, text: string }>} runs from `addedRuns`
 * @returns {string[]}
 */
export const findEnvLeaks = (isKnown, values, runs) => {
  const searched = values.map((entry) => ({
    entry,
    forms: encodedForms(entry.value),
  }));
  const leaks = [];
  for (const { file, line, text } of runs) {
    for (const { entry, forms } of searched) {
      const at = forms
        .map((form) => text.indexOf(form))
        .filter((index) => index >= 0);
      if (at.length === 0 || isKnown(entry.value)) continue;
      const offset = text.slice(0, Math.min(...at)).split("\n").length - 1;
      leaks.push(
        `${file}:${line + offset} holds the value of ${entry.name} from ${
          entry.file
        }`
      );
    }
  }
  return leaks;
};

/** Whether the tree at `ref` holds `value` anywhere */
const isKnownFor = (cwd, ref) => (value) => {
  try {
    execFileSync("git", ["grep", "-q", "-F", "-e", value, ref, "--"], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    // git grep exits 1 when nothing matches, which is the answer
    return false;
  }
};

/**
 * The diffs to check: the staged change, or each commit of the range on its
 * own, so a value one commit adds and a later one removes is still found.
 */
const diffsOf = (cwd, mode, base) => {
  if (mode === "--staged") {
    return [
      { label: "", diff: git(cwd, ["diff", "--cached", ...DIFF_OPTIONS]) },
    ];
  }
  return git(cwd, ["rev-list", "--reverse", "--no-merges", `${base}..HEAD`])
    .split("\n")
    .filter(Boolean)
    .map((commit) => ({
      label: `${commit.slice(0, 9)} `,
      diff: git(cwd, ["diff", ...DIFF_OPTIONS, `${commit}^`, commit]),
    }));
};

const main = (args) => {
  const cwd = process.cwd();
  const [mode, base] = args;
  if (
    !["--staged", "--range"].includes(mode) ||
    (mode === "--range" && !base)
  ) {
    console.error(
      "usage: node scripts/check-env-leaks.mjs --staged | --range <base>"
    );
    return 2;
  }
  const isKnown = isKnownFor(cwd, mode === "--staged" ? "HEAD" : base);
  const values = envValuesUnder(checkoutRoots(cwd));
  const leaks = diffsOf(cwd, mode, base).flatMap(({ label, diff }) =>
    findEnvLeaks(isKnown, values, addedRuns(diff)).map(
      (leak) => `${label}${leak}`
    )
  );
  if (leaks.length === 0) return 0;
  console.error(
    "check-env-leaks: these lines hold values from a local .env file; " +
      "replace each with a made-up value of the same shape:\n" +
      leaks.map((leak) => `  - ${leak}`).join("\n")
  );
  return 1;
};

if (path.basename(process.argv[1] ?? "") === "check-env-leaks.mjs") {
  process.exitCode = main(process.argv.slice(2));
}
