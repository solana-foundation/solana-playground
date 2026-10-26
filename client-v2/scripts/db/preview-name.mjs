// The name of a Cloud SQL preview database: `solpg_preview_pr_<number>` for a
// labelled PR, `solpg_preview_br_<id>` for a laptop deploy from a git branch.
// The one place either is computed: preview.yml, preview-sweep.yml,
// Makefile.vercel and the scripts under scripts/db/ all ask this module, and
// none takes a database name as input, so no label, input or variable can
// point a preview at another database.
//
//   node scripts/db/preview-name.mjs --pr 42
//   node scripts/db/preview-name.mjs --branch "$(git rev-parse --abbrev-ref HEAD)"
//
// The prefixes differ so a branch called `pr_42` cannot take PR 42's database.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PR_PREFIX = "solpg_preview_pr_";
export const BRANCH_PREFIX = "solpg_preview_br_";

/** Postgres truncates an identifier past this many bytes, so a name must fit */
const MAX_IDENTIFIER_BYTES = 63;

/** Eight hex characters of the SHA-256, appended to every branch name */
const HASH_LENGTH = 8;

/**
 * @param {number | string} pr the pull request's number
 * @returns {string}
 */
export const prDatabaseName = (pr) => {
  const text = String(pr);
  if (!/^[1-9][0-9]*$/.test(text)) {
    throw new Error(`not a pull request number: "${text}"`);
  }
  return `${PR_PREFIX}${text}`;
};

/**
 * The branch lower-cased, every character outside `[a-z0-9_]` replaced by `_`
 * (Postgres reads `-` in an unquoted identifier as an operator), cut to fit,
 * then `_` and the hash of the branch as given. The hash is always appended:
 * `fix/a-b` and `fix/a_b` sanitise alike, and two long branches can differ
 * only past the cut.
 *
 * @param {string} branch the git branch
 * @returns {string}
 */
export const branchDatabaseName = (branch) => {
  if (!branch) throw new Error("no git branch to name the database after");
  const hash = createHash("sha256")
    .update(branch)
    .digest("hex")
    .slice(0, HASH_LENGTH);
  // Every character left is ASCII, so a character is a byte
  const room = MAX_IDENTIFIER_BYTES - BRANCH_PREFIX.length - 1 - HASH_LENGTH;
  const id = branch
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, room);
  return `${BRANCH_PREFIX}${id}_${hash}`;
};

/**
 * `--pr <number>` or `--branch <name>`, exactly one.
 *
 * @param {string[]} args
 * @returns {string}
 */
export const nameFromArgs = (args) => {
  const [flag, value, ...rest] = args;
  if (rest.length || value === undefined) {
    throw new Error("usage: preview-name.mjs --pr <number> | --branch <name>");
  }
  if (flag === "--pr") return prDatabaseName(value);
  if (flag === "--branch") return branchDatabaseName(value);
  throw new Error(`unknown flag "${flag}"; expected --pr or --branch`);
};

// Real paths on both sides: `import.meta.url` is resolved through symlinks
// and `argv[1]` is not, and a silent no-op here would hand the scripts an
// empty database name
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    console.log(nameFromArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`preview-name: ${error.message}`);
    process.exitCode = 1;
  }
}
