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
 * The added lines of a unified diff made with `-U0`.
 *
 * @param {string} diff `git diff -U0` output
 * @returns {Array<{ file: string, line: number, text: string }>}
 */
export const addedLines = (diff) => {
  const added = [];
  let file = "";
  let line = 0;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) {
      file = row.startsWith("+++ b/") ? row.slice(6) : "";
    } else if (row.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(row)?.[1] ?? 0);
    } else if (row.startsWith("+") && file) {
      added.push({ file, line, text: row.slice(1) });
      line += 1;
    }
  }
  return added;
};

/**
 * The added lines that hold an env value, as `<file>:<line> holds <NAME>`.
 *
 * @param {(value: string) => boolean} isKnown whether the tracked tree already holds a value
 * @param {Array<{ name: string, value: string, file: string }>} values from `envValuesUnder`
 * @param {Array<{ file: string, line: number, text: string }>} lines from `addedLines`
 * @returns {string[]}
 */
export const findEnvLeaks = (isKnown, values, lines) => {
  const leaking = values.filter(({ value }) =>
    lines.some(({ text }) => text.includes(value))
  );
  const fresh = leaking.filter(({ value }) => !isKnown(value));
  return lines.flatMap(({ file, line, text }) =>
    fresh
      .filter(({ value }) => text.includes(value))
      .map(
        ({ name, file: envFile }) =>
          `${file}:${line} holds the value of ${name} from ${envFile}`
      )
  );
};

/** Whether the tree at `ref` holds `value` anywhere */
const isInTreeAt = (cwd, ref) => (value) => {
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

const main = (args) => {
  const cwd = process.cwd();
  const [mode, base] = args;
  const diffArgs = {
    "--staged": ["diff", "--cached", "--no-ext-diff", "--no-color", "-U0"],
    "--range": [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "-U0",
      `${base}`,
      "HEAD",
    ],
  }[mode];
  if (!diffArgs || (mode === "--range" && !base)) {
    console.error(
      "usage: node scripts/check-env-leaks.mjs --staged | --range <base>"
    );
    return 2;
  }
  const knownAt = mode === "--staged" ? "HEAD" : base;
  const leaks = findEnvLeaks(
    isInTreeAt(cwd, knownAt),
    envValuesUnder(checkoutRoots(cwd)),
    addedLines(git(cwd, diffArgs))
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
