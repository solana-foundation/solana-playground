# Spec Delta

## ADDED Requirements

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
