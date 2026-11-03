# tutorial-definition Specification

## Purpose
How a conversation tutorial is written down: the `tutorial.json` definition, its schema and the check that accepts or names every error in it, so a tutorial can be authored without touching code.

## Requirements

### Requirement: A step can pass on a refused call

A step's goal MAY be `refused`: a call of the named instruction that the
program refused. The goal SHALL name what the refusal looks like with at least
one of:

- a program error, by its name, its code or both (`NotEnoughEnergy`, `6000`);
- a pattern the transaction's log matches, for a refusal with no error code
  such as a panic or running out of memory.

`yarn tutorial:check` SHALL reject a `refused` goal that names neither, an
error that has neither a name nor a code, an instruction no step's target
defines, and a log pattern that is not a regular expression, each at its path.

#### Scenario: Lumberjack's step 3 as a definition

- **WHEN** a step's goal is `refused` with instruction `chop_tree` and error
  `NotEnoughEnergy` 6000
- **THEN** `yarn tutorial:check` accepts it

#### Scenario: A refused goal that says nothing

- **WHEN** a step's goal is `refused` with an instruction and no error and no
  log
- **THEN** `yarn tutorial:check` fails and names the goal's path

### Requirement: A call act can send argument values

Each argument of a call act SHALL be one of:

- a name: the card shows a field for it, which the learner fills;
- a name with a fixed value, a string or a whole number: the card sends it as
  given and shows no field for it;
- a name with a whole number and an amount to add: the first run sends the
  number, and each run of that card that landed adds the amount for the next.
  A run that failed or was refused sends the same value again.

`yarn tutorial:check` SHALL reject an argument named twice on one act and an
amount to add on a value that is not a whole number.

#### Scenario: Paint's fixed values

- **WHEN** a call act on `paint` gives `text` the value `"gm"` and `at` the
  value `35000`
- **THEN** pressing it sends `text` = `gm` and `at` = `35000`, with no field
  on the card

#### Scenario: Grow's growing size

- **WHEN** a call act on `grow` gives `len` the value `20480` and adds `10240`
- **THEN** its first run sends `20480`, and after that run lands the next
  sends `30720`
- **AND** after a run that is refused the next sends the same value again

### Requirement: An act can name its record line

An act beat MAY carry its record line, which the card SHALL read once its run
landed, before the time it took ("Created your map · 10 KB"). Without one the
card SHALL read its default record.

#### Scenario: Zero Copy's create card

- **WHEN** the act `init_map` with record "Created your map · 10 KB" lands
- **THEN** its record reads "Created your map · 10 KB" followed by its time

### Requirement: A write can carry its own reference and start

A write block MAY carry `ref`, the whole file the block lands in, and
`start`, the file as that write finds it. When given, they SHALL stand in for
the step's target and start of that file for that write alone: the block
lands where `ref` has it, and lines of `start` the block replaces go. A write
with neither SHALL land as before, against the step's target and start.

`yarn tutorial:check` SHALL require a block with a `ref` to appear in that
`ref` exactly once, its lines in a row, and SHALL NOT require it to appear in
the step's target. A block absent from its `ref` SHALL fail at the block's
path, and a block that appears in its `ref` more than once SHALL fail at the
`ref`'s path.

#### Scenario: Lumberjack's broken accounts struct

- **WHEN** a step's write gives `InitPlayer` without `system_program`, a
  block its step's target does not hold, with a `ref` that holds it once
- **THEN** `yarn tutorial:check` accepts it
- **AND** the block lands in `lib.rs` where the `ref` has it, not at the end

#### Scenario: Zero Copy's fix replaces a broken line

- **WHEN** a question's write gives the boxed `board` field with `ref` the
  fixed file and `start` the broken build
- **THEN** a right pick replaces the unboxed `board` line in place

#### Scenario: A ref that holds the block twice

- **WHEN** a write's `ref` holds its block's lines twice
- **THEN** `yarn tutorial:check` fails and names the write's `ref`
