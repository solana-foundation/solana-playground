# Proposal

## Why

A tutorial's write lands against its step's target, so a block that is not
in the target as written cannot be placed and is appended at the end of the
file. Almaz's Lumberjack and Zero Copy scripts write such blocks on purpose:
Lumberjack step 1 writes `InitPlayer` without `system_program` (the planned
build failure), and Zero Copy's step 1 fix replaces lines of the broken build
that the step's start does not hold. The prototype gives those writes their
own reference file and start
([HOO-2504](https://linear.app/solana-fndn/issue/HOO-2504), audit
[HOO-2503](https://linear.app/solana-fndn/issue/HOO-2503) gap G1). The two
tutorials ([HOO-2362](https://linear.app/solana-fndn/issue/HOO-2362),
[HOO-2363](https://linear.app/solana-fndn/issue/HOO-2363)) wait on it.

## What Changes

- A write block (a `write` beat's `writes`, a question's `writes`) may carry
  `ref`, the whole file the block lands in, and `start`, the file as this
  write finds it. They stand in for the step's target and start for that one
  write; without them nothing changes.
- `yarn tutorial:check` checks a block with a `ref` against the `ref`, and
  requires the block to appear there exactly once.
- The engine's write lands the block against the write's own `ref` and
  `start` when given.
- `AUTHORING.md` documents both fields.
- Telemetry: no event is added, renamed or removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

`tutorial-definition` is introduced by the open `tutorial-flow-v2` change and
not yet under `openspec/specs/`, so this delta adds a requirement rather than
modifying one.

- `tutorial-definition`: a write's own reference and start.

## Impact

- `client-v2/src/tutorials/tutorial.schema.json`, `AUTHORING.md`.
- `client-v2/src/entities/tutorial/model/definition/` (types and
  `checkDefinition`).
- `client-v2/src/features/tutorial-conversation/model/` (the write effect in
  `reducer.ts`, the write in `store.ts`).
- Out of scope: writing the Lumberjack and Zero Copy definitions (HOO-2362,
  HOO-2363); the editor's landing line, which reads the same pair once a UI
  draws it.
