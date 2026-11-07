## Context

Almaz's prototype (`ui/PlayerCard.tsx`, `ui/MemoryCard.tsx`, `ui/turns/ActCard.tsx`) keeps the player and the memory in the store from canned results. Here a card reads real results: `RunResult.wrote` (HOO-2505) names the accounts a call wrote to, by IDL name.

## Goals / Non-Goals

**Goals:** both cards on the act and result cards, from the chain, surviving a reload.

**Non-Goals:** the Call panel's account, the painted line of Zero Copy's result, the lessons themselves.

## Decisions

- **The view sits inside the act and result cards, as in the prototype,** not in a turn of its own as the ticket's first text said: the prototype wins, and the account under its own button reads as one thing.
- **Read after landing, by the name the definition gives.** `RunInput.account` carries the name; the run port reads that account from `wrote`. Reading every written account would cost a fetch per press for nothing.
- **The reading is a fact in the run** (`RunResult.account`: address, size, scalar fields), so a reload redraws it and a refused press needs no fetch: the card shows the latest reading before it. Arrays and nested data are dropped: a map's tiles are 40 KB.
- **A failed read loses the view, not the run.** It is reported, a null is read again a few times for a node behind the landing, and the card keeps the last reading.
- **The countdown is worked out on the device** from the field `refill.from`, as the prototype's `clientView`, ticking once a second. Devnet's clock and the device's can differ by seconds; the program stays the judge, and a chop too early is refused as the lesson teaches.
- **`refill` is on the act, not the tutorial,** since only step 4's program refills: step 3's card names no `refill` and shows no timer.
- **The heap is the account's size, or the size plus one 10 KB block after a refusal** (the copy that did not fit, inferred: the refusal names no size, and only a grow card has a memory view that gets refused); `zero` reads 0. On-chain state rolls back, so a refusal has no size of its own.
- **Summed records come from the presses and the readings,** in pure functions (`widgets/tutorial-conversation/model/account-card.ts`; the reading itself is the feature's, `model/account-view.ts`), replacing HOO-2505's list of lines only on a card with a view.

## Risks / Trade-offs

- A step's Reset takes its runs away, not what they did on chain: the card shows the reading before them until the next press corrects it. Reset writes no reading of its own, since a Reset cannot wait on the chain.
- A read at `confirmed` right after confirming can lag a node behind; `minContextSlot` is not worth the plumbing, since the next press corrects it. HOO-2362 checks it on devnet.
- Anchor 0.29's coder returns camelCase fields; the definition names them as the coder does (`lastLogin`), stated in AUTHORING.md.
