## Why

Almaz's Lumberjack and Zero Copy scripts repeat a call until a condition holds, and an act card today stops at its first result. Zero Copy's `Grow`, `GrowBig` and `Paint` also declare their account with no seeds, so the IDL cannot derive it and a later call needs the address an earlier call used. HOO-2362 and HOO-2363 wait on both (HOO-2505; Slava chose on 2 Nov that the engine remembers the account and the scripts stay unchanged).

## What Changes

- A `call` act may have `repeat`: one card across its presses, one line per press, a second button that runs the presses, and Stop.
- The card ends on the step's goal, or on `repeat.until`, a log pattern, and the lesson flows on.
- The engine remembers each account a landed call wrote to, other than the wallet, by its IDL name, in the saved progress. Later call acts send it, and Call panel calls too once HOO-2358 lands.
- `yarn tutorial:check` and `AUTHORING.md` learn `repeat`.

## Capabilities

### New Capabilities

### Modified Capabilities

- `tutorial-runs`: the repeating call card and the remembered accounts.
- `tutorial-definition`: `repeat` on a call act and its check rules.

## Impact

`features/tutorial-conversation` (reducer, view, progress, runners), `widgets/tutorial-conversation` (`BaseActCard`), `entities/tutorial` (definition types and check), `tutorials/tutorial.schema.json`, `tutorials/AUTHORING.md`. No new telemetry: each press fires `tutorial_action_run`. The seam with the Call panel is HOO-2358's `RunInput.call.accounts`.
