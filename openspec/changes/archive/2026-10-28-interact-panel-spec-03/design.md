# Design

## Context

`Interact.tsx` connects `BaseInteract` (head, empty states) and, on the
`ready` surface, embeds `views/sidebar/test/Component/Test`: a folded card
per instruction (`Instruction.tsx`) whose "Test" button runs
`PgProgramInteraction.test` inside `PgTerminal.process` and prints the outcome.
Nothing about the call comes back to the panel. Deploy records live in
`localStorage` under `flow.deploys` (`state/deploy-history.ts`); HOO-2385 is
extending that record and the Explorer helpers on the same base, so this
change only reads `programId`, `cluster` and `at` from it and touches neither.

The design sources: the DS prototype draws the head and the empty state and
nothing below; Almaz's stand draws a card per instruction with "Call <name>"
and a receipt; Spec 03 and Spec 12 give the result, history, callouts, copy
and the failing-line rule.

## Goals / Non-Goals

**Goals:**
- One form at a time, picked by chips, with a Call button and the result in the panel.
- Program id with copy in the head; call history per program and network.
- "Built after deploy" and "SOL needed" callouts.

**Non-Goals:**
- Run again with stored values, Explain (HOO-1759), rent estimates, the
  interface-changed callout, per-program form storage, a phone Modal page.
- New telemetry. The stage is in the legacy `views/` root; the events Spec 03
  names (`instruction_sent` with `ok`) wait for HOO-1915's naming rework.

## Decisions

1. **Chips.** Spec 03 (rebuilt 28 Oct) asks for one form picked by
   instruction chips; the design system's `Segmented` `chips` variant draws
   them and wraps on a phone.
2. **"Call <instruction>".** Spec 00 leaves "Send or Call" open; the
   tutorial's call panel (HOO-2358) and Almaz's stand say "Call <name>", so
   both panels read the same. "Calling…" in flight.
2a. **Phone stays inline.** Spec 03 draws each instruction as a Modal page
   with the action pinned to the foot; this change keeps chips, form and
   result inline on the page, a deviation raised with the designers.
3. **The call is run by the stage, the inputs stay in `Instruction`.**
   `Instruction` keeps its inputs, Fill and Reset, and takes an `onCall`
   callback, a `callBlocked` flag and a `feePayer` slot, and locks its inputs
   while its own call is in flight; it no longer talks to the terminal. A new
   `run-call.ts` sends through `PgProgramInteraction.test`,
   confirms with `PgTx.confirm`, reads logs from `getTransaction` (success
   or on-chain failure) or from the thrown `SendTransactionError.logs`
   (preflight failure), and prints the same lines to the terminal. It returns
   a plain `CallOutcome` (`call-outcome.ts`, with the failing-line rule), which
   the result and the history render; it never rejects. The sidebar's Test
   page renders the same body, so both places call alike.
4. **Pure parts are Base components, beside the stage.** They sit in
   `views/flow/stages` next to `BaseInteract` and `BaseDeploy`: the stage
   moves to a widget slice as a whole, in its own move, not part by part. `BaseCallResult` and `BaseCallHistory`
   take the outcome and records through props; `InteractBody` connects them,
   the chips and the `Instruction` form. The callouts are props of
   `BaseInteract`, computed in `Interact` from pure helpers
   (`builtAfterDeploy`, `solNeeded`) with in-source tests.
5. **History in `localStorage`, small.** `flow.calls`, 50 newest records, no
   logs (Spec 03 keeps logs; the origin budget does not). Same shape guard as
   `deploy-history.ts`.
6. **"Built after deploy" is per session.** The last green build time is
   `PgBuildOutput.latest`, which a reload drops; after a reload the callout
   stays hidden until the next build. The deploy side is the newest record for
   this project on the current network.
7. **"SOL needed" checks one fee.** 5000 lamports against the current
   wallet's balance (`useBalance`), only with a wallet and a known network; rent for accounts a call creates is not estimated.
   "Get <network> SOL" reuses `useAirdrop`.

## Risks / Trade-offs

- `getTransaction` may lag the confirmation on a slow RPC: an empty read is
  asked once more after 1.5 s, then the result shows without logs rather than
  waiting longer.
- Accounts and Events lookups stay as they were, below the history, in the old
  folded style.
- Explorer links use the current network until HOO-2385's per-record cluster
  argument lands; records already keep their cluster for that switch.
