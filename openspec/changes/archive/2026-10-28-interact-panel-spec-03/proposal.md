# Proposal

## Why

The Interact stage still embeds the old Test UI: one folded card per
instruction with a "Test" button, and the call's outcome printed only to the
terminal ("Test passed"). Spec 03 (Deploy and Interact) and Spec 12 (a call
needing SOL) ask for one form, a result in the panel, the program id, a call
history and two warnings the panel never gives today: the deployed program is
older than the code, and the wallet cannot pay the fee. The 28 Oct design
alignment audit (items B3 and C7) filed this as HOO-2386.

## What Changes

- The Interact head shows the program id it calls, shortened in the middle,
  with a copy button, next to the network.
- The instructions become chips; the picked chip draws one form. The form keeps
  the typed Arguments and Accounts inputs, Fill and Reset, gains a Fee payer
  row, and its button reads **Call <instruction>**, as in the tutorial's call panel (HOO-2358), and "Calling…" while in flight.
- A call's result shows under the form: Succeeded with the signature and an
  Explorer link that names the network, or Failed with the failing log line and
  every log behind "Show all logs". The terminal keeps printing the call.
- A call history for this program on this network lists the calls newest
  first; picking a row opens its instruction. It survives a reload.
- A "built after deploy" callout offers Redeploy when the last green build of
  this session is newer than the latest deploy on this network.
- A "SOL needed" callout appears when the fee payer cannot pay one transaction
  fee; it offers "Get devnet SOL" where the network has a faucet, and Call stays
  off until the fee is covered.
- Telemetry: none added. The stage lives in the legacy `views/flow` root, and
  Spec 16 (event naming) is being reworked under HOO-1915; `instruction_sent`
  is proposed there, not here.

## Capabilities

### New Capabilities

- `client-v2-interact`: the Interact stage's form, result, call history and
  callouts for a deployed program.

### Modified Capabilities

None.

## Impact

- Code: `client-v2/src/views/flow/stages/` (Interact, BaseInteract and new
  parts), `client-v2/src/views/flow/state/call-history.ts` (new),
  `client-v2/src/views/sidebar/test/Component/Instruction/Instruction.tsx`
  (button and call handler), `Test.tsx` (the sidebar's Test page now renders
  the same body).
- Storage: one new `localStorage` key, `flow.calls`, capped at 50 records of a
  few hundred bytes; logs are not stored.
- Out of scope: Run again with stored values, "Explain this failure"
  (HOO-1759), a rent estimate for accounts a call creates, the
  interface-changed callout, per-program form storage, a Modal page per
  instruction on a phone, per-record Explorer network (HOO-2385 adds the
  argument), and the Deploy stage (HOO-2385).
