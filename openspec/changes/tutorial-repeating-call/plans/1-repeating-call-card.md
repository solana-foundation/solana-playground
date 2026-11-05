# 1 The repeating call card and the remembered accounts (HOO-2505)

**Success metric:** on the preview, Zero Copy's grow step runs to its end with
"until done" and a reload mid-lesson keeps the map; Lumberjack's chop step ends
on its condition with one record line per chop. The lessons land later (HOO-2362,
HOO-2363), so this task proves it on fixture definitions.

Design source: Almaz's `design-system/src/prototype/tutorial-v2/ui/turns/ActCard.tsx`
on `almaz/mobile-tutorial-prototype`.

## Decisions

- **No saved state for the card.** The press count is `runs`, the end is the
  cursor: `ended` holds the flow until `repeat.until` matches, so the card has
  ended once the cursor moved past it or the step passed. A reload needs nothing
  new. The repetition is the card's own state, so a reload cannot resume it.
- **`until` is a log pattern,** judged as a `call` goal of the card's instruction,
  so `tutorial:check` and `judgeGoal` stay the only readers of a pattern.
- **Memory is by what a call wrote to,** not by a list in the definition: Almaz's
  script stays unchanged, and a panel call counts the same. A signer is never
  filled, since an address cannot sign.

## Tasks

1. **Definition.** `repeat` in `types.ts`, the schema, `check.ts`, AUTHORING.md.
2. **Reducer.** `act` refuses a card the cursor has passed and sends
   `input.log = repeat.until`; `ended` holds the flow until it matches.
3. **View.** One turn per repeating beat with its `presses`; `retryAct` skips it.
4. **Card.** `BaseActCard` rows, the second button, Stop, the 250 ms loop.
5. **Memory.** `wrote` on decoded calls and on a landed result, named from the
   IDL, `accounts` in the progress, sent on `input.call.accounts` and applied in
   `sendCall`.
6. **Seam.** The Call panel's prop and form come from HOO-2358: its PR reads
   `progress.accounts` to fill them.

## Gate

`yarn run check`, the module's in-source tests and component tests. No e2e spec
changes.
