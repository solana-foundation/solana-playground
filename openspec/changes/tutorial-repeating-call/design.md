## Context

The act card is one record per run, and `flow` moves the lesson on after a run that landed. Almaz's prototype (`ui/turns/ActCard.tsx`, `almaz/mobile-tutorial-prototype`) keeps a chop or grow card live with rows, and runs it to the end on a second button.

## Goals / Non-Goals

**Goals:** the repeating card, its end conditions, and the remembered accounts, with a reload keeping both.

**Non-Goals:** the lesson's account view on the card and its summing record (HOO-2506); the lessons themselves (HOO-2362, HOO-2363).

## Decisions

- **No saved state for the card.** The press count is `runs`, and the end is the cursor: `ended` holds the flow until `repeat.until` matches, so the card has ended once the cursor moved past it or the step passed. A saved "ended" flag was the alternative, and it could disagree with the cursor.
- **The repetition lives in the card.** A reload cannot then resume it, as a run is never repeated by the engine.
- **`until` is a log pattern,** judged as a `call` goal of the card's instruction, so `judgeGoal` stays the only reader of a pattern. A goal object was the alternative; it would repeat the instruction for nothing.
- **Memory is by what a call wrote to,** not a list in the definition: the scripts stay unchanged and a panel call counts the same. A signer is never filled, since an address cannot sign.
- **The finished card shows every line,** where Almaz's folds to one line with lesson-specific sums: without the sums the lines are the only account of what happened (Design alignment, 5 Nov).

## Risks / Trade-offs

- A step's Reset keeps the memory; the step's own create call replaces it, so the worst case is a stale address before that press, which the flow's order prevents.
- Almaz's `init_map` has seeds, so it needs an IDL that carries them. HOO-2363 confirms this on devnet.
