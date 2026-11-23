# Tasks

Both tasks land in one docs-only PR, 1.1 before 1.2. Creating the area labels, and moving existing issues and
milestones to the spec's rules, is the work of the team that tracks in Linear and is planned outside this
repository; neither task waits for it.

## 1. The rule lands in the repository

- [ ] 1.1 Land this change's proposal, design, spec delta, and tasks in a docs-only PR, and in it add `process` to the
  layers the `**Area:**` rule under `rules.specs` of `openspec/config.yaml` accepts; verify with `yarn spec:validate`
  passing and with `openspec instructions specs --change project-tracking --json` listing `process` among the layers
  (ticket to file)
- [ ] 1.2 In the PR of 1.1, add a root `AGENTS.md` that opens with one line pointing at the root `CLAUDE.md` for the
  rest of the project's instructions and holds a `## Project tracking` section, and add the line `@AGENTS.md` under
  the title of the root `CLAUDE.md`, as `client-v2/CLAUDE.md` has it (design.md, decision 9); the section says when
  it applies (before an agent files, takes, relabels, re-prioritises, or moves a Linear issue of Solana Playground,
  or creates a milestone or a label there) and links the spec as a relative link; it names no team and no Linear
  project, and restates no requirement of the spec; the link points at
  `openspec/changes/project-tracking/specs/project-tracking/spec.md` while the change is open, and at
  `openspec/specs/project-tracking/spec.md` when this PR also archives the change; `greptile.json` stays as it is,
  because the section holds no review rule; depends on 1.1; verify that the link resolves, that `git ls-files` lists
  `AGENTS.md`, and that a fresh Claude Code session at the repository root, asked which rules apply before it files
  a Linear issue for Solana Playground, names the spec's path (ticket to file)

## Workflow follow-up

- Whether the change is archived is asked on the PR that ticks the last task, as `client-v2/CLAUDE.md`, "Specs and
  changes", says. That PR is the one of 1.1 and 1.2.
- A PR that archives the change later re-points the link in the root `AGENTS.md` to
  `openspec/specs/project-tracking/spec.md`.
