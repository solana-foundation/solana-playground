# Design

## Context

A `call` goal passed only on a confirmed call (`judgeGoal` in `client-v2/src/features/tutorial-conversation/model/goals.ts`). Two runs of Lumberjack's step 2 on a wallet whose player PDA already existed (HOO-2362) produced results that pass nothing: a client run that sent no transaction (`reason: "no_transaction"`), and a Call panel call whose failed result carries `refused: { instruction: "init_player", error: { code: 0, name: null } }` and the System Program's `Allocate: account Address { address: ..., base: None } already in use` log line.

## Goals / Non-Goals

**Goals:** pass the goal on both results when the definition opts in; tell the learner why in the tutorial's voice; keep every other failure a failure.

**Non-Goals:** a `call` act before the goal's that creates an account; accounts with no seeds on the client-run path; drawing the account card on this path.

## Decisions

- **Opt in through the definition, not the IDL.** Anchor's IDL carries no `init` marker. A writable PDA beside the System Program also describes a `realloc` (Zero Copy's `grow`), so an IDL heuristic would pass a step on the wrong instruction. `goal.creates` names the account; `checkDefinition` checks it against the step's shipped IDL.
- **The runner states the fact, the judge decides.** The runner puts `exists: { instruction, account, address }` on a failed run or call result when it sees the existing account. It does so only for the instruction and account `RunInput.creates` names, which the engine fills from the live step's goal. `judgeGoal` passes a `call` goal on a failed result only when `exists` names the goal's instruction and `creates`.
- **The refusal test.** The refusal names the goal's instruction, its error code is 0, and the log holds a line matching `^(Allocate|Create Account): account .* already in use$`. Code 0 alone is not taken as proof, since it is the first variant of any error enum; the log line names the cause.
- **The client-run lookup.** `client.ts` decides by itself not to call `init_player`, so no log exists. The runner builds the goal instruction's account generator from the IDL, the way the Call panel builds its form (`createGeneratableInstruction`), and resolves it only when it is `From seed`; a `Custom` or `Random` generator would be a guess. The derived address is read with the run's existing `fetchAccount`.
- **The record.** A failed result the goal accepts is recorded with status `refused`, the status that already means "failed, and the step's goal accepted it": no Explain, the win follows. `parseRun` keeps such a record when its result carries `refusal` or `exists`.
- **The reason.** `StepTime.reason` (`"exists"`) is saved with the step's pass, so the win reads `existsLine` after a reload, and `tutorial_step_passed` carries the same value.
- **The copy.** The result card and the Call panel show one string, `existsLine` in `features/tutorial-conversation/model/progress.ts`, which the feed's view and the Call panel's view put on the result they hand the cards, since a Base component takes only types from the feature. The tutorial's explanation is the win's `existsLine`, shown where `line` would be, before Next.
- **The record's status.** Reusing `refused` adds one more string literal the engine compares by hand; a `TODO(HOO-2362)` on `RunRecord` asks for an enum or typed invariants, and one on the reducer asks for the lesson as an explicit state machine, each in a change of its own.

## Risks / Trade-offs

- `tutorial_action_run` reports such a run as `failed`, since the run itself did not land; `tutorial_step_passed.reason` is where the pass is counted.
- A log line format change in the System Program would make the refusal path fail as before, not pass wrongly.
