#!/usr/bin/env node
// Merge upstream (solpg/master) into foundation/master on a sync branch and open or update its PR.
//
// Usage:
//   sync-upstream.mjs message <from> <to>   print the commit message for from..to
//   sync-upstream.mjs synced-to <subject>   print the <to> hash a sync commit subject names
//   sync-upstream.mjs prepare               fetch, merge into a sync worktree, commit when nothing conflicts
//   sync-upstream.mjs commit [<worktree>]   commit the merge after conflicts were resolved by hand
//   sync-upstream.mjs publish [<worktree>]  push the sync branch and open or update the PR
//
// Env overrides: UPSTREAM_REMOTE (solpg), UPSTREAM_BRANCH (master), TARGET_REMOTE (foundation),
//   TARGET_BRANCH (master), PUSH_REMOTE (hoodieshq), SYNC_BRANCH_PREFIX (sync/),
//   WORKTREE_ROOT (<main checkout>/.worktrees), SYNC_NO_SIGN (unset; 1 commits unsigned, dry runs only).
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const env = process.env;
const UPSTREAM_REMOTE = env.UPSTREAM_REMOTE || "solpg";
const UPSTREAM_BRANCH = env.UPSTREAM_BRANCH || "master";
const TARGET_REMOTE = env.TARGET_REMOTE || "foundation";
const TARGET_BRANCH = env.TARGET_BRANCH || "master";
const PUSH_REMOTE = env.PUSH_REMOTE || "hoodieshq";
const SYNC_BRANCH_PREFIX = env.SYNC_BRANCH_PREFIX || "sync/";

const SUBJECT_PREFIX = "chore(upstream): ";
// Matches the squash subjects ("sync to") and the merge subjects ("merge <remote>/<branch> to").
const SUBJECT_RE =
  /^chore\(upstream\): (sync|merge [^ ]+) to [0-9a-f]+ \(([0-9a-f]+)\.\.([0-9a-f]+)\)$/;

// "<path> <regex>": a hit is content the merge brings back that foundation/master lacks; no regex means the path itself.
export const GUARDS = [
  "compose.yaml ^x-client:",
  "compose.yaml ^  client(-prod|-standalone)?:",
  "client-v2/scripts/update-static.mjs",
  '.gitmodules ^\\[submodule "client/public"\\]',
  "server/src/routes/share.rs",
];

/** The `<to>` hash a sync commit subject names, or `undefined` for any other subject. */
export const parseSyncedTo = (subject) => SUBJECT_RE.exec(subject)?.[3];

/** One `- <hash8> <subject>` line per commit, oldest first; body lines become `  * ` sub-bullets. */
export const formatMessage = (upstreamRef, from8, to8, commits) =>
  `${SUBJECT_PREFIX}merge ${upstreamRef} to ${to8} (${from8}..${to8})\n\n` +
  commits
    .flatMap(({ summary, body }) => [
      summary,
      ...body
        .split("\n")
        .filter((line) => !/^[ \t\r\f\v]*$/.test(line))
        .map((line) => `  * ${line.replace(/^\* ?/, "")}`),
    ])
    .map((line) => `${line}\n`)
    .join("");

/** Whether a guard entry fires, given the file's content after the merge and on the target (`undefined`: absent). */
export const isGuardHit = (entry, merged, target) => {
  const source = entry.split(" ").slice(1).join(" ");
  const has = source
    ? (content) =>
        content !== undefined && new RegExp(source, "m").test(content)
    : (content) => content !== undefined;
  return has(merged) && !has(target);
};

const die = (text) => {
  process.stderr.write(`error: ${text}\n`);
  process.exit(1);
};

const spawn = (cmd, args, stdio) =>
  spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio,
  });

// Mirrors `set -e`: the failing command's own stderr is the message.
const run = (cmd, args) => {
  const result = spawn(cmd, args, ["ignore", "pipe", "inherit"]);
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.replace(/\n+$/, "");
};

const show = (cmd, args) => {
  const result = spawn(cmd, args, "inherit");
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const succeeds = (cmd, args) =>
  spawn(cmd, args, ["ignore", "ignore", "ignore"]).status === 0;

const tryRead = (cmd, args) => {
  const result = spawn(cmd, args, ["ignore", "pipe", "ignore"]);
  return result.status === 0 ? result.stdout : undefined;
};

const git = (cwd, ...args) => run("git", ["-C", cwd, ...args]);

const short = (repo, rev) => git(repo, "rev-parse", "--short=8", rev);

const signFlag = () => (env.SYNC_NO_SIGN === "1" ? "--no-gpg-sign" : "-S");

/** The commit message for `from..to`, read from the repository at `repo`. */
export const message = (repo, from, to) =>
  formatMessage(
    `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`,
    short(repo, from),
    short(repo, to),
    git(repo, "rev-list", "--reverse", `${from}..${to}`)
      .split("\n")
      .filter(Boolean)
      .map((sha) => ({
        summary: git(repo, "log", "-1", "--format=- %h %s", "--abbrev=8", sha),
        body: git(repo, "log", "-1", "--format=%b", sha),
      }))
  );

// Foundation merges PRs by squash or rebase, so the previous upstream tip survives only in the subject.
const previousTo = (repo) => {
  const subject = git(
    repo,
    "log",
    "-1",
    "--format=%s",
    "-E",
    "--grep=^chore\\(upstream\\): (sync|merge [^ ]+) to ",
    `${TARGET_REMOTE}/${TARGET_BRANCH}`
  );
  const to = parseSyncedTo(subject);
  if (to === undefined)
    die(`no upstream sync subject on ${TARGET_REMOTE}/${TARGET_BRANCH}`);
  const sha = tryRead("git", [
    "-C",
    repo,
    "rev-parse",
    "--verify",
    "--quiet",
    `${to}^{commit}`,
  ]);
  if (sha === undefined)
    die(`previous sync point ${to} is unknown; fetch ${UPSTREAM_REMOTE}`);
  return sha.trim();
};

const repoSlug = (repo, remote) =>
  run("gh", [
    "repo",
    "view",
    git(repo, "remote", "get-url", remote),
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);

const remoteOwner = (repo, remote) =>
  run("gh", [
    "repo",
    "view",
    git(repo, "remote", "get-url", remote),
    "--json",
    "owner",
    "--jq",
    ".owner.login",
  ]);

// Head branch of an open sync PR from the push remote, so a rerun updates that PR instead of opening another.
const openSyncBranch = (owner, slug) =>
  JSON.parse(
    run("gh", [
      "pr",
      "list",
      "--repo",
      slug,
      "--base",
      TARGET_BRANCH,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "headRefName,headRepositoryOwner,title",
    ])
  ).find(
    (pr) =>
      pr.headRepositoryOwner.login === owner &&
      pr.headRefName.startsWith(`${SYNC_BRANCH_PREFIX}merge-`) &&
      pr.title.startsWith(`${SUBJECT_PREFIX}merge `)
  )?.headRefName;

const worktreeOf = (repo, branch) => {
  let worktree;
  for (const line of git(repo, "worktree", "list", "--porcelain").split("\n")) {
    const [key, value] = line.split(" ");
    if (key === "worktree") worktree = line.slice("worktree ".length);
    if (key === "branch" && value === `refs/heads/${branch}`) return worktree;
  }
  return undefined;
};

const stateDir = (wt) =>
  path.join(
    git(wt, "rev-parse", "--path-format=absolute", "--git-dir"),
    "sync-upstream"
  );

const readState = (state, name) =>
  readFileSync(path.join(state, name), "utf8").replace(/\n+$/, "");

const writeState = (state, name, value) =>
  writeFileSync(path.join(state, name), value);

// client/ is upstream's client, which the fork keeps at its own state until it is deleted.
const restoreClient = (wt, target) => {
  git(wt, "rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", "client");
  if (succeeds("git", ["-C", wt, "cat-file", "-e", `${target}:client`])) {
    git(wt, "reset", "-q", target, "--", "client");
    git(wt, "checkout", "--", "client");
  }
  git(wt, "clean", "-fdq", "--", "client");
};

const guard = (wt, target) => {
  const hits = GUARDS.filter((entry) => {
    const file = entry.split(" ")[0];
    return isGuardHit(
      entry,
      tryRead("git", ["-C", wt, "show", `:${file}`]),
      tryRead("git", ["-C", wt, "show", `${target}:${file}`])
    );
  });
  if (hits.length > 0)
    die(
      `the merge brings back what ${TARGET_REMOTE}/${TARGET_BRANCH} removed: ${hits
        .map((entry) => `\n  ${entry}`)
        .join("")}`
    );
};

const self = () => process.argv[1];

const commitMerge = (repo, wt) => {
  const state = stateDir(wt);
  if (
    !existsSync(path.join(state, "target")) ||
    !existsSync(path.join(state, "to"))
  )
    die(`no prepared sync in ${wt}; run prepare`);
  const target = readState(state, "target");
  const to = readState(state, "to");
  const mergeHead = tryRead("git", [
    "-C",
    wt,
    "rev-parse",
    "-q",
    "--verify",
    "MERGE_HEAD",
  ]);
  if (mergeHead?.trim() !== to)
    die(`no merge of ${short(repo, to)} in progress in ${wt}; run prepare`);

  const unmerged = git(wt, "diff", "--name-only", "--diff-filter=U")
    .split("\n")
    .filter(Boolean);
  if (unmerged.length > 0)
    die(
      `resolve these in ${wt}, stage them, then run: ${self()} commit ${wt}${unmerged
        .map((file) => `\n  ${file}`)
        .join("")}`
    );
  if (
    !succeeds("git", [
      "-C",
      wt,
      "diff",
      "--cached",
      "--quiet",
      target,
      "--",
      "client",
    ])
  )
    die(
      `client/ differs from ${short(
        repo,
        target
      )}; restore it with: git -C ${wt} checkout ${target} -- client`
    );
  guard(wt, target);

  show("git", [
    "-C",
    wt,
    "commit",
    "-q",
    signFlag(),
    "-F",
    path.join(state, "message.txt"),
  ]);
  writeState(state, "commit", `${git(wt, "rev-parse", "HEAD")}\n`);
  console.log(
    `merge commit ${git(wt, "rev-parse", "--short=8", "HEAD")} on ${git(
      wt,
      "symbolic-ref",
      "--short",
      "HEAD"
    )} in ${wt}`
  );
  console.log(`next, after the user's go-ahead: ${self()} publish ${wt}`);
};

const prepare = (repo) => {
  git(repo, "fetch", "--quiet", UPSTREAM_REMOTE, UPSTREAM_BRANCH);
  git(repo, "fetch", "--quiet", TARGET_REMOTE, TARGET_BRANCH);

  const target = git(repo, "rev-parse", `${TARGET_REMOTE}/${TARGET_BRANCH}`);
  const to = git(repo, "rev-parse", `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`);
  const from = previousTo(repo);
  if (from === to)
    die(
      `nothing to sync: ${TARGET_REMOTE}/${TARGET_BRANCH} already has ${short(
        repo,
        to
      )}`
    );
  if (!succeeds("git", ["-C", repo, "merge-base", "--is-ancestor", from, to]))
    die(
      `previous sync point ${short(
        repo,
        from
      )} is not an ancestor of ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`
    );
  const to8 = short(repo, to);

  const owner = remoteOwner(repo, PUSH_REMOTE);
  const slug = repoSlug(repo, TARGET_REMOTE);
  const branch =
    openSyncBranch(owner, slug) || `${SYNC_BRANCH_PREFIX}merge-${to8}`;

  // Rebuild from the newest target: the previous merge commit is replaced, never stacked on.
  let wt = worktreeOf(repo, branch);
  if (wt !== undefined) {
    if (
      succeeds("git", ["-C", wt, "rev-parse", "-q", "--verify", "MERGE_HEAD"])
    )
      die(
        `a merge is in progress in ${wt}; finish it with commit or run: git -C ${wt} merge --abort`
      );
    if (git(wt, "status", "--porcelain") !== "")
      die(`${wt} has uncommitted changes`);
    git(wt, "checkout", "-q", "-B", branch, target);
  } else {
    const mainCheckout = path.dirname(
      git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    );
    wt = path.join(
      env.WORKTREE_ROOT || path.join(mainCheckout, ".worktrees"),
      branch
    );
    if (existsSync(wt)) die(`${wt} exists but does not hold ${branch}`);
    show("git", [
      "-C",
      repo,
      "worktree",
      "add",
      "-q",
      "-B",
      branch,
      wt,
      target,
    ]);
  }

  const state = stateDir(wt);
  mkdirSync(state, { recursive: true });
  writeState(state, "target", `${target}\n`);
  writeState(state, "to", `${to}\n`);
  rmSync(path.join(state, "commit"), { force: true });
  // Lease on the remote tip seen now, so publish refuses to overwrite a push made after prepare.
  const lease = git(
    repo,
    "ls-remote",
    PUSH_REMOTE,
    `refs/heads/${branch}`
  ).split("\t")[0];
  writeState(state, "lease", `${lease}\n`);
  const text = message(repo, from, to);
  writeState(state, "message.txt", text);

  const count = git(repo, "rev-list", "--count", `${from}..${to}`);
  console.log(
    `range: ${short(repo, from)}..${to8}, ${count} commits; base ${short(
      repo,
      target
    )}; branch ${branch} in ${wt}`
  );
  // A conflicting merge exits non-zero; the unmerged paths are reported by commitMerge.
  spawn(
    "git",
    [
      "-C",
      wt,
      "merge",
      "--quiet",
      "--no-commit",
      "--no-ff",
      "-X",
      "theirs",
      to,
    ],
    "inherit"
  );
  restoreClient(wt, target);
  process.stdout.write(`\n${text}\n`);
  commitMerge(repo, wt);
};

const publish = (repo, wt) => {
  const state = stateDir(wt);
  if (!existsSync(path.join(state, "commit")))
    die(`no committed sync in ${wt}; run prepare`);
  const commit = readState(state, "commit");
  const branch = git(wt, "symbolic-ref", "--short", "HEAD");
  if (git(wt, "rev-parse", "HEAD") !== commit)
    die(`${branch} moved since prepare; run prepare again`);
  if (!/^gpgsig/m.test(git(wt, "cat-file", "commit", commit)))
    die(
      `${short(
        repo,
        commit
      )} is unsigned; run prepare again without SYNC_NO_SIGN`
    );
  if (
    !succeeds("git", [
      "-C",
      wt,
      "diff",
      "--quiet",
      readState(state, "target"),
      commit,
      "--",
      "client",
    ])
  )
    die(`client/ differs from ${TARGET_REMOTE}/${TARGET_BRANCH}`);

  const lease = readState(state, "lease");
  show("git", [
    "-C",
    wt,
    "push",
    `--force-with-lease=refs/heads/${branch}:${lease}`,
    PUSH_REMOTE,
    branch,
  ]);

  const owner = remoteOwner(wt, PUSH_REMOTE);
  const slug = repoSlug(wt, TARGET_REMOTE);
  const lines = readFileSync(path.join(state, "message.txt"), "utf8").split(
    "\n"
  );
  const title = lines[0];
  const bodyFile = path.join(state, "body.md");
  writeFileSync(bodyFile, lines.slice(2).join("\n"));
  const existing = JSON.parse(
    run("gh", [
      "pr",
      "list",
      "--repo",
      slug,
      "--head",
      branch,
      "--base",
      TARGET_BRANCH,
      "--state",
      "open",
      "--json",
      "url,headRepositoryOwner",
    ])
  ).find((pr) => pr.headRepositoryOwner.login === owner)?.url;
  if (existing) {
    show("gh", [
      "pr",
      "edit",
      existing,
      "--title",
      title,
      "--body-file",
      bodyFile,
    ]);
    console.log(existing);
  } else {
    show("gh", [
      "pr",
      "create",
      "--repo",
      slug,
      "--base",
      TARGET_BRANCH,
      "--head",
      `${owner}:${branch}`,
      "--title",
      title,
      "--body-file",
      bodyFile,
    ]);
  }
};

const worktreeArg = (arg) =>
  git(arg || process.cwd(), "rev-parse", "--show-toplevel");

const main = (args) => {
  const usage = `usage: ${self()} message <from> <to> | synced-to <subject> | prepare | commit [<worktree>] | publish [<worktree>]`;
  const repo = () => git(process.cwd(), "rev-parse", "--show-toplevel");
  switch (args[0]) {
    case "message":
      if (args.length !== 3) die(`usage: ${self()} message <from> <to>`);
      process.stdout.write(message(repo(), args[1], args[2]));
      break;
    case "synced-to": {
      if (args.length !== 2) die(`usage: ${self()} synced-to <subject>`);
      const to = parseSyncedTo(args[1]);
      if (to === undefined) die(`not a sync subject: ${args[1]}`);
      console.log(to);
      break;
    }
    case "prepare":
      prepare(repo());
      break;
    case "commit":
      commitMerge(repo(), worktreeArg(args[1]));
      break;
    case "publish":
      publish(repo(), worktreeArg(args[1]));
      break;
    default:
      die(usage);
  }
};

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename)
  main(process.argv.slice(2));
