# Proposal

## Why

Funding the Playground wallet from an external one usually means sending
everything it holds. The Fund dialog makes the user work out the balance less
the fee by hand. Sergey raised it on the 7 Nov call; Slava wants it before
Breakpoint as small polish (HOO-2713). The dialog is redone in HOO-2399, so
the change stays small.

## What Changes

- A `Max` button sits at the end of the amount field. It fills the field with
  the paying wallet's balance less the 0.001 SOL the send check keeps for the
  fee, so Send is enabled on the filled amount.
- `Max` is disabled while the balance is loading or unreadable, and when the
  balance does not exceed the fee reserve.

## Capabilities

### Modified Capabilities

- `client-v2-wallet-funding`: the amount field gets a Max button

## Impact

- `client-v2/src/features/fund-wallet/model/fund.ts` (`maxAmount`),
  `client-v2/src/features/fund-wallet/ui/BaseFundDialog.tsx` (the field
  becomes an `InputGroup` with the button at its end).
