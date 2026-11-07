# Design

## Context

`tutorial-flow-v2` task 3.2 (HOO-1790) judges goals in
`features/tutorial-conversation/model/goals.ts`; `judgeGoal` returns false
for any result with `ok: false`. The reducer (`reducer.ts`, `ended`) records
an `ok: false` result as a `failed` run and returns before judging, so no
failure can pass a step. A failed `run`/`call` result holds only `message` and
`log`. A call act's `call.args` lists argument names only; the learner's values
arrive on the `act` action. The real runner for calls is task 4.3 (HOO-2357),
not built yet.

## Goals / Non-Goals

**Goals:**

- Lumberjack step 3 and Zero Copy steps 2 and 3 expressible in `tutorial.json`
  and accepted by `yarn tutorial:check`.
- The engine passes a `refused` step only on a refusal it can see in the
  result.

**Non-Goals:**

- Decoding a transaction's error (task 4.3 fills the new field).
- Repeating a card until a condition, and remembering accounts across calls
  (HOO-2505).
- Rendering the record line in the feed's card (task 3.3 renders cards;
  this change carries the line into the view model).

## Decisions

1. **`refused` is its own goal kind, not a flag on `call`.** A `call` goal's
   fields (`args`, `log` on the picked line) describe a confirmed call; a
   refusal is judged on other facts (an error, the whole log). A separate kind
   keeps `judgeGoal`'s switch exhaustive and the schema's `oneOf` readable.
   Alternative: `call` with `refused: true` — rejected, half of `call`'s fields
   would mean nothing on it.
2. **A failed `run`/`call` result gains an optional `refused`:**
   `{ instruction, error: { code, name | null } | null }`. Absent means the
   transaction never reached the program. Optional so saved progress and the
   unwired runner stay valid. The log pattern is matched against the failed
   result's existing `log`, all lines, case-blind like `call`'s.
3. **The reducer has a refused branch before the failure branch.** In
   `ended`, an `ok: false` result the judge accepts for the step's goal is
   recorded `{ status: "refused" }` and passes the step through `passStep`
   (via `chat` or `client` as for a confirmed call). Every other `ok: false`
   result is `failed`, as now. `explain` and `fixMyself` act only on `failed`
   runs, so a refused run offers neither. `passed` (Call panel) already goes
   through the judge and needs nothing new.
4. **Argument values live in the definition, computed in the reducer.** An
   argument is `string` (a field) or `{ name, value }` or
   `{ name, value: integer, add: integer }`. On `act`, the reducer merges the
   learner's values for the named fields with the definition's values; a
   growing value is `value + add × (runs of this beat that landed)`. Counting
   landed runs needs nothing new in the save and reloads to the same value.
   Alternative: read the last sent value back from `called` — rejected, it
   depends on the runner decoding it and on the Call panel never calling in
   between.
5. **`record` is a plain string on any act beat**, carried into the act's view
   as its record line. Not `Text`: a record line has no phone variant in the
   prototype.

## Risks / Trade-offs

- [The grow count ignores grows from the Call panel] → HOO-2505 makes the
  engine remember account state; until then a learner who grows from the panel
  sends a size the program refuses as too big, which fails rather than passes.
- [A refusal pattern too broad passes the wrong refusal] → AUTHORING.md says to
  name the error when there is one and to pick a log phrase only the expected
  refusal prints; Zero Copy's scenario pins "too big" against "out of memory".
