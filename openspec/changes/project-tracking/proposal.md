# Proposal

## Why

The order of the pieces of work on Solana Playground was agreed in conversation and written nowhere. In Linear,
milestones named product areas, which have no order and no end; issue priority was defined against one release date
and said nothing after it; and an issue outside every milestone had no stated place in the plan. While the project
lead was away, a contributor could not read from Linear which piece of work comes first, or which issue to take next.

## What Changes

- A new capability `project-tracking` states how planned work on Solana Playground is recorded in the Linear project.
  Linear holds the order between pieces of work and which issues are planned; an OpenSpec change's `tasks.md` holds
  the steps inside one piece. Slack and calls carry discussion, and an order agreed there takes effect when the
  project shows it.
- A milestone is one complete piece of work. Its description states `Done when:` and `Owner:`. A milestone names no
  product area and no kind of work. It is finished when its progress reads 100% and a project update names it
  finished, and a finished milestone receives no further issue.
- The order of the open milestones in the project overview is the priority order, and nothing else copies it. Only
  the project lead or the deputy creates, reorders, or finishes a milestone, and the project description names the
  deputy.
- A person or an agent takes the next issue from the first open milestone in the order that holds work for them. An
  open issue with no milestone is unplanned and waits for the lead's or the deputy's agreement.
- Issue priority orders the issues of one milestone. Urgent is the exception: anyone sets it for an issue that stops
  production or a contributor's work today, and an Urgent issue is taken first wherever it sits.
- The product area of an issue is one label named `spg-<area>`, a label of the team that owns the project. The
  prefix keeps the name apart from the workspace's labels, which every team of the workspace shares. An issue
  carries at most one. Only the lead or the deputy decides on a new area label; an issue whose part has no label is
  filed without one, and its description names the part.
- The kind of work uses a label the workspace already has, such as `Bug` or `Tech Debt`, and gets no `spg-` label and
  no milestone.
- A Linear project update records each milestone that is created, finished, or moved, with the reason. A project
  update is posted at least once a week while the project is in progress, and it names the open issues that carry
  two area labels.
- An issue carries a due date only for a date someone outside the team depends on. A planned finish is the
  milestone's target date.
- `openspec/config.yaml` accepts `process` as a layer in the `**Area:**` line of a capability's Purpose.
- The repository starts to track a root `AGENTS.md`, whose section `## Project tracking` points an agent at the
  capability before it files, takes, relabels, re-prioritises, or moves a Linear issue. The root `CLAUDE.md` imports
  it with `@AGENTS.md`, as `client-v2/CLAUDE.md` imports `client-v2/AGENTS.md`.
- This change sets the rules only. Bringing an existing Linear project in line with them is the work of the team
  that tracks there, and is planned outside this repository.
- Telemetry: no slice under `features/` or `widgets/` changes; the change adds, renames, and removes no telemetry
  event, and touches no funnel step's code.

User-visible consequence: none in the product. A contributor reads the priority order from the project overview,
finds an issue's product area in its `spg-` label, and knows from an issue's milestone, or the lack of one, whether
the issue is planned.

## Capabilities

### New Capabilities

- `project-tracking`: how planned work on Solana Playground is recorded in Linear: what a milestone is and when it is
  finished, the priority order, which issue is taken next, what issue priority and a due date mean, the `spg-` area
  labels, the deputy, and the project updates that record a change to the milestones.

### Modified Capabilities

None.

## Impact

- Linear: the rules govern the milestones, labels, issue priority, due dates, description, and updates of the project
  of Solana Playground. No task of this change edits Linear.
- Repository: `openspec/config.yaml` (the layer list of the `**Area:**` rule), a new root `AGENTS.md`, and one import
  line in the root `CLAUDE.md`. No code under `client-v2/`, `server/`, or `wasm/` changes.
- Access: who may create a team label in Linear, alone or in a label group, is a setting of the team (design.md,
  decision 3).
- Order: the proposal, the `process` layer, and the two instruction-file edits land in one docs-only PR. Nothing in
  the repository waits for the Linear project to change.
- Out of scope: moving existing issues, milestones, saved views, and due dates to these rules; the other projects of
  the team and of the workspace; splitting the work into several Linear projects or an initiative; cycles and
  estimates; a script that checks these rules through Linear's API; any Slack automation.
