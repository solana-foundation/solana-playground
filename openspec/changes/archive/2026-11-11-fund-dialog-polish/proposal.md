# Proposal

## Why

Sergey Prokhorov asked on the 7 Nov call for four changes to the "Fund your
Playground wallet" dialog, then set them aside while the built-in wallet
looked short-lived. On 10 Nov he reversed that: Kora's timing is unknown, so
the Playground wallet and the user's own wallet live side by side for a
while, and the dialog that moves SOL between them should be finished now.
Ticket HOO-2787. No designer spec or prototype screen covers this dialog, so
the choices below are ours and go to the designers' gap batch.

## What Changes

- **Explorer links.** The receiving account's short address, and the paying
  wallet's, marked ↗, open that address in the user's block explorer on the
  Playground's cluster, in a new tab. A cluster the explorer cannot open
  (Solscan on a local validator) keeps the plain address.
- **Wallet badge.** The paying wallet's name shows as a badge with its icon,
  so the wallet the SOL comes from reads at a glance.
- **Amount.** The field starts at 0 and steps by 0.1 SOL with the arrow keys
  and with − and + buttons beside Max. At 0 the field asks for an amount
  above 0 as a hint, not an error, and Send stays off.
- **Wording.** The note under the field reads `Arrives in <receiver> on
  <network>.` instead of `Sent on <network>.`, which read as if the SOL had
  already gone.
- **Send is the call to action.** Send takes the brand button, as a dialog's
  one call to action does in `BaseModalFrame`; Cancel becomes the ghost
  button beside it. On a phone, as in that frame, Cancel goes and Send spans
  the foot in the flat accent.

The model gains the 0.1 step and the new start; no event, send check or
transfer path changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-wallet-funding`: how the dialog shows the two addresses, the
  paying wallet, the amount's start and step, the note's wording, and the
  send button.
