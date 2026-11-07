## Why

Two specs draw the Interact stage differently. client-v2-interact (Spec 03,
HOO-2386) picks one instruction with chips and opens its form with Args and
Accounts folds and "Call <name>". client-v2-stages (Almaz's hoodieshq #272, on
foundation master) draws a card per instruction with "n args · n accounts",
plain Arguments and Accounts groups and Test with a held reason. Design
alignment ruled on 6 Nov 00:14 that the #272 card is the design (HOO-2652).

## What Changes

- The instruction chips go. Each instruction is a card in IDL order that
  folds on its own; all are folded on arrival.
- The card head shows "n args · n accounts"; once open, its inputs sit under
  plain "Arguments" and "Accounts" groups, with the label of client-v2-stages.
- One row ends the card: Test (primary, "Testing…" in flight), quiet "Fill
  with Random" and "Reset", and the reason Test waits (wallet, then SOL for
  the fee, then the fields).
- The last result sits right under the card that made the call; a Call
  history row opens its instruction's card and scrolls to it.
- Kept: program id head, Fee payer, Call history beside the form, the
  callouts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-interact`: the chips requirement is replaced by the card; the
  Call button becomes Test; the history row opens a card; the wide layout
  names cards instead of chips.

## Impact

`client-v2/src/views/flow/stages/InteractBody.tsx`,
`client-v2/src/views/sidebar/test/Component/Instruction/Instruction.tsx`,
`client-v2/src/views/sidebar/test/Component/Interaction.tsx`,
`client-v2/src/views/sidebar/test/Component/InputLabel.tsx`, their tests, and
the Interact e2e specs that press "Call <name>" or pick a chip.
