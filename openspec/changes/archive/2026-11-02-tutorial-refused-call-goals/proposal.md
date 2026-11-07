# Proposal

## Why

Almaz's Lumberjack and Zero Copy scripts cannot be written as `tutorial.json`
v1 without inventing fields or hand-editing JSON
([HOO-2502](https://linear.app/solana-fndn/issue/HOO-2502)). Lumberjack's
step 3 passes when `chop_tree` is refused with `NotEnoughEnergy` (6000), and
Zero Copy's step 2 when `grow` runs out of memory, but a v1 goal passes only
on a confirmed call. Zero Copy's calls also send fixed and growing argument
values, and its cards end on their own record line. Their content tickets
([HOO-2362](https://linear.app/solana-fndn/issue/HOO-2362),
[HOO-2363](https://linear.app/solana-fndn/issue/HOO-2363)) are due by 6 Nov.

## What Changes

- A new goal kind, `refused`: a call of the named instruction that the program
  refused, matched by its program error (name, code or both) or by a pattern
  over the transaction's log (a panic has no code), or both.
- A failed run or call result carries what the program refused: the
  instruction and its error, when there was one.
- The engine treats a refusal that meets the step's goal as its own outcome:
  the run is recorded as refused, the step passes, and no Explain or "I'll fix
  it myself" follows. A refusal that does not meet the goal stays an ordinary
  failure.
- A call act's argument is a name the learner fills (as now), a fixed value
  sent as given, or a value that grows by a fixed amount with each run of the
  card that landed.
- An act beat may carry its own record line ("Created your map · 10 KB").
- Chop, Send and Grow are call acts with their own button labels; no new act
  kinds.
- `yarn tutorial:check` checks all of it, and `AUTHORING.md` documents it.
- Telemetry: no event is added, renamed or removed. `tutorial_step_passed`
  fires for a step passed on a refusal as for any other.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

Both capabilities are introduced by the open `tutorial-flow-v2` change and not
yet under `openspec/specs/`, so these deltas add requirements rather than
modify them.

- `tutorial-definition`: refused goals, argument values on call acts, an
  act's record line.
- `tutorial-runs`: a step passes on a refusal its goal names.

## Impact

- `client-v2/src/tutorials/tutorial.schema.json`, `AUTHORING.md`.
- `client-v2/src/entities/tutorial/model/definition/` (types and
  `checkDefinition`).
- `client-v2/src/features/tutorial-conversation/model/` (`goals.ts`,
  `reducer.ts`, `progress.ts`, `view.ts`).
- Out of scope: a card that repeats until a condition (Grow to 40 KB) and
  accounts created by earlier calls
  ([HOO-2505](https://linear.app/solana-fndn/issue/HOO-2505)); filling the
  refusal from a real transaction (the run ticket, `tutorial-flow-v2` task
  4.3); writing the Lumberjack and Zero Copy definitions (HOO-2362,
  HOO-2363); the account-size goal, dropped because no step uses it.
