## Why

Lumberjack and Zero Copy are about an account: energy that drops and comes back, a map that grows past the heap. Nothing in the feed draws an account, so both lessons would be lines of log. Found by the audit HOO-2503 (gap G6); ticket HOO-2506.

## What Changes

- An act in a definition may name an account view with `account`: a `player` or a `memory` view of the account by its IDL name.
- A run or call that landed reads that account from the chain and saves the reading with the run.
- The act card, while live, and the result card draw the view: Almaz's player card and memory card.
- A repeating card with a view sums its presses in one record line, and a grow keeps its memory card.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tutorial-definition`: an act's `account` field.
- `tutorial-runs`: reading the account after a landed run.
- `tutorial-conversation`: the views on the act and result cards.

## Impact

`entities/tutorial` (types, schema, check), `features/tutorial-conversation` (progress, run port, view), `widgets/tutorial-conversation` (two new cards, act and result cards), `tutorials/AUTHORING.md`. Stacked on `tutorial-repeating-call` (HOO-2505). The lessons are HOO-2362 and HOO-2363; this change proves itself on fixtures.
