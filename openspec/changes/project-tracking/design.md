# Design

## Context

See [proposal.md](proposal.md), "Why". The facts below were read from the repository at `12416edb7`, and from
Linear's and Claude Code's documentation on 23 Nov 2026.

- A Linear workspace may hold the labels and the projects of several products, and a workspace label is shared by
  every team of the workspace.
- The [Members and roles](https://linear.app/docs/members-roles) page: a team's owners choose whether all members or
  only team owners create and edit the team's labels. A guest of a workspace takes a member's actions inside its
  teams, cannot open settings beyond its own account, and cannot see initiatives or workspace views.
- The [Project milestones](https://linear.app/docs/project-milestones) page: a milestone has a description and an
  optional target date, shows its completion as a percentage of its issues, is reordered by dragging in the project
  overview, and converts into a project.
- The [Issue labels](https://linear.app/docs/labels) page: an issue holds one label of a label group; a label or a
  group is created from an issue's Add label flow, a group with the syntax `group/label`; in a view over several
  teams, labels of different teams that share a name filter as one label; creating a workspace label with the name
  of a team label offers to convert the team label to the workspace; a label's description is shown on hover and
  read by Triage Intelligence when it suggests a label.
- The [Updates](https://linear.app/docs/initiative-and-project-updates) page: a project update carries a health and
  a text and appears in the project's Updates tab. It is posted to Slack when a channel is selected for the project
  and the project has a public team. A reminder to the project lead may be set on a schedule.
- [How Claude remembers your project](https://code.claude.com/docs/en/memory): by default Claude Code reads
  `AGENTS.md` only in a repository with no `CLAUDE.md`, and a `CLAUDE.md` that holds the line `@AGENTS.md` imports
  it.
- `client-v2/CLAUDE.md` opens with `@AGENTS.md`, so `client-v2/AGENTS.md` is the one copy of the rules both kinds of
  agent read there. The repository tracks no root `AGENTS.md`.

## Goals / Non-Goals

**Goals:**

- A contributor reads the priority order from one place in Linear while the lead is away.
- The order has one copy, so no second text states an order that is no longer true.
- An issue's product area stays readable after the piece of work it belonged to is finished.
- The structure names no team and no issue, so a fork that tracks its work elsewhere keeps the rules and changes
  only where they point.

**Non-Goals:**

- Enforcing the rules with a script or a Linear automation. The author of the weekly update checks the area labels
  (spec, "A project update records each change to the milestones").
- Changing how an issue is written, the issue statuses, or the pull request flow.
- Naming the pieces of work or their order. The lead decides both in Linear.
- Moving existing issues and milestones to these rules. That is the tracking team's own plan (proposal.md,
  "Impact").

## Decisions

### 1. One project, one milestone per piece of work

The work stays in the one project, and each complete piece of work is a milestone of it.

Alternatives considered:

- A Linear project per piece of work, grouped under an initiative. Each piece would have a lead, a health, and its
  own updates. Rejected: a workspace holds the projects of other products, a guest account cannot see initiatives,
  and every piece would need its own weekly update. A milestone converts into a project, so a piece that outgrows a
  milestone moves later.
- A ranked list in Slack, as a pinned message or a canvas. Rejected: Slack carries discussion, and an issue would
  have no link to the rank of its piece of work.

### 2. The drag order of the milestones is the only copy of the order

The order of the open milestones in the project overview is the priority order. The project description explains how
to read the project and holds no list of milestones.

Alternatives considered:

- A rank number in each milestone's name. The rank would show wherever an issue shows its milestone, but each change
  of order would rename several milestones.
- A ranked list in the project description. This is a second copy, and a copy stays in place after the plan it
  states has ended.
- A split into Now, Next, and Later with a limit on Now. Rejected as unneeded: a strict order with the rule for the
  next issue (spec, "The next issue comes from the first milestone with work") already puts the work on the first
  milestones.

### 3. The product area is a team label `spg-<area>`, in a single-select group where the team allows it

Each product area is one label of the team that owns the project, whose name starts with `spg-`, short for Solana
Playground.

- The prefix is part of the label's name, because a group's name is not. Without it, a name such as `infra` is
  likely to match a workspace label of another product, and a workspace label created later with the name of an area
  label would offer to absorb it.
- The label belongs to the team, so the other teams of the workspace do not see it in their label pickers.
- The labels go into one label group, `spg-area`, created from an issue's Add label flow as `spg-area/spg-<area>`.
  Linear then allows one label of the group per issue, which enforces the spec's "at most one". Who may create a
  team label, alone or in a group, is one setting of the team, so the group needs no right a flat label does not.
- When the workspace refuses the group, the labels are created flat. The spec reads the same either way, because it
  names the prefix and not the group, and the weekly update catches an issue with two area labels.
- Only the lead or the deputy decides on a new area label. An agent that created labels on its own would give one
  part of the product two names, and an agent that reads the spec before the labels exist would create a set of its
  own. An issue whose part has no label is filed without one, and its description names the part.

Alternatives considered:

- Reusing a label group the workspace has for another product's areas. Rejected: its labels describe that product.
- Labels with plain names such as `infra` in the group. Rejected: the plain names collide.
- A label named after each piece of work. Rejected: the milestone already records the piece of work, and such a
  label would end with the milestone, while the area has to outlast it.

Unverified: whether the team's setting lets a member or a guest create a label or a group. The first attempt to
create `spg-area` settles it.

### 4. The area labels

| Label | Part of the product |
| --- | --- |
| `spg-assistant` | The assistant panel, its backends, tools, and MCP servers |
| `spg-sync` | Sign-in, accounts, conversation history, and project sync |
| `spg-sharing` | Gist and GitHub import and export, and share links |
| `spg-interact` | Reading a program's IDL, the Interact stage, and seeds |
| `spg-editor` | The Monaco editor, rust-analyzer, and the editor crates |
| `spg-build-server` | `server/`, its build routes and toolchains, and the build-server proxy |
| `spg-terminal` | The terminal and its commands, such as `solana`, `spl-token`, and `anchor` |
| `spg-deploy` | The Deploy stage, program keypairs, and program authority |
| `spg-wallet` | The built-in wallet, its key origin, and external wallets |
| `spg-tutorials` | The tutorial flow, lessons, and lesson validation |
| `spg-shell` | The four-column frame, Home, settings, themes, and the phone layout |
| `spg-infra` | CI, the Vercel and GCP deploys, secrets, and observability |

The second column is each label's description. The table is the set the labels start from; after that the team's
labels in Linear are the list in force, and a part the table does not name gets a label when the lead or the deputy
decides so (spec, "Only the lead or the deputy decides on an area label").

### 5. A kind of work keeps its workspace label

A bug, technical debt, and audit work are kinds of work, and a workspace usually has a label for each, with a
description that names no product. An issue carries that label beside its area label, and no `spg-` label is created
for a kind. A view over the workspace then lists one kind of work across every product.

### 6. An issue with no milestone is unplanned

Most review follow-ups and small bugs belong to no piece of work, so they have no milestone. The area label is how
they are found when the next piece of work is defined. No milestone is created to hold them, because it would name
no outcome (spec, "A milestone is one complete piece of work").

### 7. Priority orders inside a milestone, Urgent goes first, and a due date is an outside commitment

The milestone order ranks the pieces of work, so issue priority is left to rank the issues of one piece. Urgent is
the one priority that crosses milestones, and anyone sets it: the person who sees production fail does not wait for
the lead. A due date on an issue would be a second statement of when work finishes, beside the milestone's target
date, and a past due date on an open issue states an urgency the milestone order does not give. So an issue carries
a due date only for a date someone outside the team depends on.

### 8. Project updates carry what the overview cannot show

Linear shows a milestone's completion only as a percentage, so a project update is what names a milestone finished,
once every issue in it is closed. The same update records a created or a moved milestone with the reason. The Updates
tab lists every update, so a missing week is visible, and the weekly update is where the area labels are checked.
The deputy, whom the project description names, posts it while the lead is away.

Alternative considered: an update only when the milestones change. Rejected: a week with no update cannot be told
apart from a week in which nobody looked at the order.

### 9. Agents learn the format from the root `AGENTS.md`, which `CLAUDE.md` imports

A `## Project tracking` section of the root `AGENTS.md` says when the spec applies and links it. The root `CLAUDE.md`
gains the line `@AGENTS.md`, so Claude Code loads the same text, as `client-v2/CLAUDE.md` does with
`client-v2/AGENTS.md`. Agents that read `AGENTS.md` and Claude Code then read one copy, and it is reviewed in a pull
request. The section names no team and no Linear project, so it stays true for a fork that tracks its work
elsewhere.

Alternatives considered:

- The same text in `.claude/rules/project-tracking.md` and in `AGENTS.md`. Rejected: two copies that only a review
  keeps equal, where the repository already has a one-copy pattern.
- A paragraph in the root `CLAUDE.md` alone. Rejected: an agent that reads `AGENTS.md` does not read `CLAUDE.md`.
- Claude Code's auto memory directory, placed in the repository. Rejected for two reasons. `autoMemoryDirectory`
  takes an absolute or `~/`-prefixed path, so a tracked settings file cannot name a folder inside each contributor's
  checkout. Auto memory is what Claude writes for one person, without review: a tracked folder would collect every
  contributor's private notes and turn unreviewed text into instructions for the whole team.

## Risks / Trade-offs

- [The workspace refuses the label group] → the labels are created flat, an issue may then carry two, and the weekly
  update names such an issue (decision 3).
- [The order stops being maintained] → the weekly update is a requirement, and its absence shows in the Updates
  tab.
- [An agent files an issue by defaults that predate this change] → the root `AGENTS.md` points at the spec, and the
  root `CLAUDE.md` imports it (decision 9).
- [The pointer reaches agents before the area labels exist] → an agent creates no label: it files the issue without
  an `spg-` label and names the part in the description (spec, "An area label names the part of the product"). So
  the pointer lands with the proposal and does not wait for the labels.
- [The import brings all of the root `AGENTS.md` into every Claude Code session] → the file holds the pointer and
  one line that sends other agents to `CLAUDE.md`, so the import adds a few lines to a session; whoever adds text to
  the file later adds it to every session.
- [A milestone has no owner field] → the owner is a line of its description and cannot be filtered on.

## Migration Plan

None in this repository. A team that already tracks its work in Linear moves its issues and milestones to these
rules on a plan of its own. The repository's tasks do not wait for that plan: until the area labels of decision 4
exist in the Linear project, an agent that follows the spec files an issue without an area label and names the part
in its description.

## Open Questions

- Does the workspace let a member of the team create the group `spg-area`? Decision 3 holds either way.
- Is a Slack channel selected for the project's updates? If it is not, the author pastes the update's link. Neither
  changes the spec.
