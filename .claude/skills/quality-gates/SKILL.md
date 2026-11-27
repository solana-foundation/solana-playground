---
name: quality-gates
description: >
  Checks a PR, named files, or a draft text against the weighted gates under `.agents/gates/` and prints one line
  per violation with the gate id and weight, then a summary line. Report-only. Use for /quality-gates, "check the
  gates", "does this break a gate", "check this draft against the writing gates".
argument-hint: "[pr | files <path>... | draft] [--base <ref>]"
---

# quality-gates

Runs the `gates-review` agent on changed lines and reports its findings. The mode is `pr` unless the argument
names another; the base is the default base of step 1 unless `--base <ref>` names another.

`<root>` is `git rev-parse --show-toplevel`. `<dir>` is `<root>/.github/reviews/<branch>.gates/`, with `/` in the
branch name replaced by `-`; create it, and overwrite what a previous run left there. `<skill>` is this skill's
directory. Run each command with absolute paths and `git -C <root>`, never `cd`.

## 1. Resolve the base

The default base is `master` of the remote whose fetch URL names `solana-foundation/solana-playground`, whatever
that remote is called in this clone: find it in `git -C <root> remote -v`, run `git -C <root> fetch <remote> master`,
and use `<remote>/master`. No remote matches → stop and say
`no remote for solana-foundation/solana-playground; pass --base <ref>`. A `--base` that is a remote-tracking ref is
fetched the same way first. Then `git -C <root> merge-base HEAD <base>`. No merge base →
stop and say `no merge base with <base>`. Never fall back to the whole repository: a review of every line is not
a review of the PR.

## 2. Skip an upstream sync

`git -C <root> log --format=%s <merge-base>..HEAD`. A subject starting `chore(upstream): sync` → print
`quality-gates: skipped, upstream sync range` and stop. Upstream's code is held to upstream's rules.

## 3. Read the gates at the merge base

A PR must not weaken the gates that judge it, so the gates come from the merge base:

```sh
git -C <root> ls-tree -r --name-only <merge-base> .agents/gates
```

For each listed `.md` file other than `.agents/gates/README.md` and the generated `.agents/gates/INDEX.md`, append to `<dir>/gates.md` a line
`<!-- gate <id> -->`, where the id is the path under `.agents/gates/` without `.md`, then the output of
`git -C <root> show <merge-base>:<path>`.

Warn, naming each file, for every gate file the range or the working tree changes:
`git -C <root> diff --name-only <merge-base> -- .agents/gates` and
`git -C <root> ls-files --others --exclude-standard -- .agents/gates`. Such an edit takes effect only after it
merges.

**No gate at the merge base** (the PR that adds the gates): build `<dir>/gates.md` the same way from the working
tree files under `<root>/.agents/gates/`, print `gates read from the working tree: none on <base> yet`, and skip
the warnings.

Then run `node <skill>/scripts/lint-gates.mjs <root>/.agents/gates`. Print each error it reports as a warning: a
malformed gate in the working tree fails the PR that adds it, through the reviewers, not through this run.

## 4. Collect the lines

Write `<dir>/changed-lines.tsv`, one `<path>\t<line number>\t<line>` row per line.

**`pr`**: the added lines since the merge base, working tree included, with their new line numbers, then every
line of each untracked file. `client/`, `server/`, and `wasm/` are upstream's and are left out, and so is
`.github/reviews/`:

```sh
bash <skill>/scripts/changed-lines.sh pr <root> <merge-base> > <dir>/changed-lines.tsv
```

**`files <path>...`**: every line of each named file, paths relative to `<root>`:

```sh
bash <skill>/scripts/changed-lines.sh files <root> <path>... > <dir>/changed-lines.tsv
```

**`draft`**: the text under discussion in the conversation, written as rows `draft\t<line number>\t<line>`.
Keep only the blocks of `<dir>/gates.md` whose id starts `writing/`.

No rows → print `quality-gates: no changed lines in scope` and stop.

## 5. Run the reviewer

Launch the `gates-review` agent with the absolute paths of `<dir>/gates.md` and `<dir>/changed-lines.tsv`. Print
its lines as they come, then one summary line:

```text
quality-gates @ <short sha of HEAD>: highest open weight <w>, <n> violations
```

`<w>` is the highest weight among the findings, or `none`. Violations are never summed into a score. A 1.0
violation is reported here and blocks nothing; blocking belongs to a review tool that reads the `## Review` section
of `AGENTS.md`.

## 6. Report only

Never edit a file during the run. Fix a finding only when the user asks for fixes after the report.
