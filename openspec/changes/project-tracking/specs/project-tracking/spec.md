# Spec Delta

## Purpose

**Area:** the Linear project of Solana Playground: its milestones, issue labels, issue priority, due dates, and
project updates (process).

How planned work on Solana Playground is recorded in Linear, so that a contributor reads from the project alone which
piece of work comes first and which issue to take next.

## ADDED Requirements

### Requirement: Linear holds the order of the work

The Linear project of Solana Playground SHALL be the only record of the order between pieces of work and of which
issues are planned. An OpenSpec change's `tasks.md` holds the steps inside one piece of work and ranks no piece
against another. Slack and calls carry discussion, and an order agreed there SHALL take effect when the project
shows it.

#### Scenario: An order agreed in Slack (manual)

- **WHEN** a contributor picks the next issue after the lead agreed in a Slack thread to an order the project
  overview does not show
- **THEN** takes the issue the order in the project overview gives

### Requirement: A milestone is one complete piece of work

Each milestone SHALL name one outcome that can be finished. Its description SHALL hold a line that starts with
`Done when:`, and a line that starts with `Owner:` and names who answers questions about its scope. A milestone SHALL
NOT name a product area or a kind of work, because neither can be finished.

#### Scenario: A milestone for an outcome (manual)

- **WHEN** the lead creates a milestone
- **THEN** names an outcome in its title
- **AND** states `Done when:` and `Owner:` in its description

#### Scenario: A product area proposed as a milestone (manual)

- **WHEN** someone proposes to the lead a milestone named for a product area, such as "Deploys"
- **THEN** gets no milestone
- **AND** stays recorded by the `spg-` label of its issues

### Requirement: A finished milestone stays finished

A milestone SHALL be finished when every issue in it is closed, so that its progress reads 100%, and a project update
names it finished. Until then it is open. A finished milestone SHALL keep its issues as the record of that work and
SHALL receive no further issue. Work found later SHALL go to an open milestone whose outcome needs it, or to no
milestone.

#### Scenario: The outcome is reached (manual)

- **WHEN** the lead or the deputy sees that the `Done when:` condition of a milestone holds
- **THEN** moves each issue still open in it to another milestone or to none
- **AND** posts a project update that names the milestone finished

#### Scenario: A follow-up to a finished milestone (manual)

- **WHEN** a review finds a follow-up to the work of a finished milestone
- **THEN** files the issue with no milestone, or in an open milestone whose outcome needs it

### Requirement: The milestone order is the priority order

The open milestones SHALL stand in one strict order in the project overview, the most important first. That order
SHALL be the only copy of the priority order. Only the project lead or the deputy SHALL create, reorder, or finish a
milestone.

#### Scenario: Reading the priorities (manual)

- **WHEN** a contributor opens the project overview
- **THEN** reads the open milestones from the most important to the least important

#### Scenario: A contributor disagrees with the order (manual)

- **WHEN** a contributor thinks a milestone stands too low
- **THEN** raises it with the lead or the deputy
- **AND** leaves the order as it is

### Requirement: The project description names the deputy

The project description SHALL name one deputy, who acts for the lead while the lead is away. It SHALL explain how to
read the project: the milestone order, the rule for the next issue, and the area labels. It SHALL hold no list of
milestones, because the project overview holds the order.

#### Scenario: The lead is away (manual)

- **WHEN** a contributor needs an unplanned issue agreed while the lead is away
- **THEN** finds the deputy's name in the project description

### Requirement: The next issue comes from the first milestone with work

A person or an agent that takes an issue SHALL first take an open Urgent issue they can work on, wherever it sits.
Otherwise they SHALL take an issue from the first open milestone in the order that holds an unassigned issue they can
work on. An open issue with no milestone is unplanned and, unless it is Urgent, SHALL be started only after the lead
or the deputy agrees.

#### Scenario: Work is available in the first milestone (manual)

- **WHEN** a contributor finishes an issue and the first milestone holds an unassigned issue they can work on
- **THEN** takes an issue from the first milestone

#### Scenario: No suitable work in the first milestone (manual)

- **WHEN** a contributor picks the next issue and the first milestone holds no unassigned issue they can work on
- **THEN** takes an issue from the next milestone in the order that holds one

#### Scenario: An Urgent issue in a later milestone (manual)

- **WHEN** a contributor picks the next issue while an open Urgent issue they can work on sits in the third milestone
- **THEN** takes the Urgent issue before any issue of the first milestone

#### Scenario: An unplanned issue (manual)

- **WHEN** a contributor wants to start an open issue that has no milestone and is not Urgent
- **THEN** asks the lead or the deputy before starting it

### Requirement: Priority orders issues inside a milestone

Issue priority SHALL order the issues of one milestone: among the issues a taker can work on there, the highest
priority goes first. Priority SHALL NOT rank an issue above the issues of an earlier milestone, except Urgent. Urgent
SHALL mark only an issue that stops production or a contributor's work today, and any contributor or agent that finds
such an issue SHALL set it without asking the lead.

#### Scenario: A High issue in a later milestone (manual)

- **WHEN** a contributor picks between a High issue of the third milestone and a Medium issue of the first
- **THEN** takes the Medium issue first

#### Scenario: Two priorities in one milestone (manual)

- **WHEN** a contributor picks between a High and a Medium unassigned issue of the first milestone
- **THEN** takes the High issue first

#### Scenario: Production is broken (manual)

- **WHEN** a contributor or an agent finds that production does not serve users
- **THEN** sets the priority of the issue that reports it to Urgent
- **AND** starts it without waiting for a milestone or for the lead

### Requirement: An area label names the part of the product

An open issue of the project SHALL carry at most one label whose name starts with `spg-`, and exactly one when an
`spg-` label names the part of the product the issue changes. An issue that changes a part no `spg-` label names
SHALL be filed without one, and its description SHALL say which part has no label.

#### Scenario: An issue for a part that has a label (manual)

- **WHEN** a person or an agent files an issue that changes a part an `spg-` label names
- **THEN** sets that one `spg-` label on it

#### Scenario: An issue that changes two parts (manual)

- **WHEN** a person or an agent files an issue that changes two parts of the product
- **THEN** sets the one `spg-` label of the part where most of the change lands

#### Scenario: A part of the product without a label (manual)

- **WHEN** a person or an agent files an issue and no `spg-` label names the part the issue changes
- **THEN** files the issue without an `spg-` label
- **AND** names the part that has no label in the issue's description

### Requirement: Only the lead or the deputy decides on an area label

An `spg-` label SHALL be created only when the project lead or the deputy decides so. It SHALL be a label of the team
that owns the project, SHALL name a part of the product and never a piece of work, and SHALL carry a description.

#### Scenario: A new area label (manual)

- **WHEN** the lead or the deputy decides that a part of the product needs an `spg-` label
- **THEN** adds a label of the team that owns the project, named `spg-<part>`, with a description
- **AND** sets it on the open issues that were filed without one for that part

#### Scenario: Someone else wants a label that does not exist (manual)

- **WHEN** a contributor or an agent other than the lead or the deputy judges that no existing `spg-` label fits an
  issue
- **THEN** creates no label

### Requirement: A kind of work uses a workspace label

The kind of work, such as a bug, technical debt, or audit work, SHALL be recorded with a label the workspace already
has. A kind of work SHALL NOT get an `spg-` label or a milestone of its own.

#### Scenario: A technical-debt issue (manual)

- **WHEN** a person or an agent files an issue that is technical debt in the build server
- **THEN** sets the workspace's label for technical debt and the area label `spg-build-server`

### Requirement: A project update records each change to the milestones

Each time a milestone is created, finished, or moved to another position, a Linear project update SHALL record it,
naming the milestone and the reason. While the project is in progress, a project update SHALL be posted at least once
a week, by the lead or, when the lead is away, by the deputy. The weekly update SHALL name each open issue that
carries two `spg-` labels and SHALL count the open issues that carry none.

#### Scenario: The order changes (manual)

- **WHEN** the lead moves a milestone to another position
- **THEN** posts a project update naming the milestone, both positions, and the reason

#### Scenario: The lead is away (manual)

- **WHEN** the weekly project update is due and the lead is away
- **THEN** is posted by the deputy

#### Scenario: The weekly check (manual)

- **WHEN** the author of the weekly update finds an open issue that carries two `spg-` labels
- **THEN** names the issue in the update

### Requirement: A due date states an outside commitment

An issue SHALL carry a due date only when someone outside the team depends on that date. A planned finish SHALL be the
target date of the milestone.

#### Scenario: A planned finish (manual)

- **WHEN** the lead plans when a piece of work finishes
- **THEN** sets the milestone's target date
- **AND** sets no due date on its issues

#### Scenario: A date someone outside the team depends on (manual)

- **WHEN** someone outside the team needs one issue done by a stated date
- **THEN** sets that date as the issue's due date
