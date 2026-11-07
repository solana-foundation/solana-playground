# Proposal

## Why

A step whose goal is a `call` of an instruction that creates an account with Anchor's `init` can never pass for a learner whose wallet already made that account (HOO-2362). On devnet, Lumberjack's step 2 (`init_player`) failed both ways: `client.ts` found the player and sent nothing ("No transaction"), and the Call panel's `initPlayer` was refused by the System Program with `Allocate: account ... already in use` (custom error 0x0). Zero Copy's step 2 (`init_map`) has the same flaw. A learner who repeats a tutorial with the same wallet is stuck, with no word on why.

## What Changes

- A `call` goal may name the account its instruction creates, `creates`. The Anchor IDL does not mark `init` (Zero Copy's `grow` has the same writable PDA and System Program as `init_map`), so the definition opts in rather than the engine guessing from the IDL.
- A step whose goal has `creates` also passes when the goal's instruction is refused because that account already exists: the System Program's "already in use" refusal (custom error 0x0) inside the goal's instruction. A call that fails for any other reason still fails.
- A client run that sends no transaction passes the same goal when the account `creates` names is on chain at the address the step's IDL derives from its seeds, the same derivation the Call panel sends with. An account with no seeds is not looked up.
- Such a pass shows a passing outcome on the result card and in the Call panel ("Already exists"), records the run as accepted by the goal, and moves the step bar on. Nothing is sent to the chain.
- The win of such a step carries `existsLine`, the tutorial's own explanation of why the account already exists, shown in place of `line` (and `callPanelLine`) on that path. `checkDefinition` requires `existsLine` with `creates` and refuses it without, and refuses a `creates` the step's IDL does not list for the instruction.
- Lumberjack's step 2 and Zero Copy's step 2 opt in, each with its `existsLine`.
- Telemetry: no new event. `tutorial_step_passed` gains an optional `reason`, `"exists"`, sent only on this path. `tutorial_action_run` keeps `failed` for the run itself.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tutorial-runs`: a `call` goal with `creates` passes on an existing account, the result says so, the win explains it, and `tutorial_step_passed` carries `reason: "exists"`.
- `tutorial-definition`: a `call` goal may carry `creates`, and its win then carries `existsLine`.

## Impact

- Code: `client-v2/src/entities/tutorial` (definition types, `checkDefinition`, the event's declaration), `client-v2/src/features/tutorial-conversation` (judge, runner, engine, progress, view), `client-v2/src/widgets/tutorial-conversation` (result and win cards), `client-v2/src/widgets/tutorial-workspace` (Call panel result), `client-v2/src/tutorials` (schema, `AUTHORING.md`, Lumberjack, Zero Copy).
- Saved progress gains an optional `reason` on a step's time and an optional `exists` on a failed run's result; a save without them reads as before.
- Out of scope: a `call` act before the goal's that creates an account (Zero Copy's `init_big_map` in step 4) still fails on an existing account; `AUTHORING.md` keeps advising `init_if_needed` for such calls. An account with no seeds is not looked up on the client-run path. The account card is not drawn on the existing-account result.
