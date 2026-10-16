/**
 * Mirror the `client/public` assets submodule into `client-v2/public`, which is
 * gitignored rather than tracked.
 *
 * `client-v2` deliberately does not carry its own submodule: a submodule's git
 * dir is shared across linked worktrees via `.git/modules`, so initialising it
 * in one worktree detaches it in every other. The source is therefore always
 * the *primary* checkout's `client/public`, even when run from a worktree —
 * a worktree copies files in and never touches a submodule of its own.
 *
 * Run via `make update-static` after cloning, after creating a worktree, or
 * after bumping the submodule.
 */
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";

import { CLIENT_PATH, exists } from "./utils.mjs";

const TIMESTAMPS_FILE = "tutorial-timestamps.json";

const git = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

// `--git-common-dir` resolves to the primary checkout's `.git` from a linked
// worktree as well as from the primary itself, which is what makes this work.
const primaryRoot = path.dirname(
  git(["rev-parse", "--path-format=absolute", "--git-common-dir"], CLIENT_PATH).trim()
);

const SOURCE_PATH = path.join(primaryRoot, "client", "public");
const DEST_PATH = path.join(CLIENT_PATH, "public");

if (!(await exists(path.join(SOURCE_PATH, "index.html")))) {
  console.log(`Initialising the assets submodule in ${primaryRoot}`);
  git(["submodule", "update", "--init", "client/public"], primaryRoot);
}
if (!(await exists(path.join(SOURCE_PATH, "index.html")))) {
  throw new Error(`${SOURCE_PATH} has no index.html after submodule init`);
}

/** Tracked paths only, so generated `crates`/`packages`/`content.json` never copy */
const sourceFiles = git(["ls-files", "-z"], SOURCE_PATH).split("\0").filter(Boolean);

for (const file of sourceFiles) {
  const to = path.join(DEST_PATH, file);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(path.join(SOURCE_PATH, file), to);
}

// craco derives each tutorial's date from git history. The destination is not a
// git repo of its own, so capture the real dates from the source while we can.
const tutorialsPath = path.join(SOURCE_PATH, "tutorials");
const timestamps = {};
for (const name of await fs.readdir(tutorialsPath)) {
  if (name.startsWith("_")) continue;
  const dir = path.join(tutorialsPath, name);
  if (!(await exists(path.join(dir, "data.json")))) continue;

  const added = git(
    ["log", "--follow", "--format=%ad", "--date=unix", "--diff-filter=A", "."],
    dir
  )
    .split("\n")
    .filter(Boolean)
    .pop();
  if (added) timestamps[name] = Number(added);
}

await fs.writeFile(
  path.join(DEST_PATH, TIMESTAMPS_FILE),
  JSON.stringify(timestamps, null, 2) + "\n"
);

const commit = git(["rev-parse", "--short", "HEAD"], SOURCE_PATH).trim();
console.log(
  `Synced ${sourceFiles.length} files from ${path.relative(primaryRoot, SOURCE_PATH)}@${commit}` +
    `, dated ${Object.keys(timestamps).length} tutorials`
);
