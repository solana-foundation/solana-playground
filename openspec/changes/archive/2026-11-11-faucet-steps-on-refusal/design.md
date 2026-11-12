# Design

## Context

#490 brought `webFaucetSteps` and the refused states of the wallet chip, the
wallet menu toast and the tutorial cards, all gated on `isRateLimited` /
`isFaucetLimit`. The deploy prompt's `airdrop_failed` already shows the steps
for any refusal. The chip and the menu call `useAirdrop().airdrop()`, which
runs the `airdrop` command, so they receive whatever it throws: sign-in
failures, "This network has no faucet.", "The network is still loading." and
the request's own failures alike.

## Goals / Non-Goals

**Goals:** one notion of "refused" shared by every surface; the cause in
words true to it; the same three steps and link everywhere.

**Non-Goals:** new telemetry; changing the deploy prompt; an assistant tool
that airdrops.

## Decisions

- **A typed refusal, thrown by the command.** `airdrop` wraps a failure of
  the request phase in `AirdropRefusedError` (same message, `cause` kept), and
  `isAirdropRefused` reads it. Callers then need no list of non-refusal
  messages. Alternative: treat every error but a sign-in failure as a refusal
  in each caller; it would show faucet steps for "This network has no
  faucet." and "still loading".
- **Only where the web faucet serves the cluster.** A local validator's
  failure is rethrown unwrapped: the web faucet funds devnet or testnet, never
  the user's own validator.
- **One type for the cause.** `AirdropRefusal` (`"limit" | "other"`) and
  `refusalOf` in `report.ts`; the chip's `refusedFor` and the toast's
  `refusal` take it and are required, so no caller shows "at its limit" by
  default.
- **The cause stays the message's.** `isRateLimited` still decides limit vs
  other, so the existing tests and telemetry reasons hold.
- **The amount in the link is one the faucet offers.** `faucetLink` drops an
  amount the form lacks, and step 2 says the amount is filled in; so the
  terminal note asks for the requested amount when the form offers it and
  for `DEVNET_FAUCET_SOL` otherwise, and step 2 names that amount.
- **The tutorial cards share the chip's words.** "The faucet did not send
  SOL." replaces "The airdrop didn't go through." (Design alignment, 11 Nov),
  so a card and the chip never disagree about one refusal.
- **Fund-wallet files are touched by one prop each.** The ticket names the
  wallet chip; HOO-2787 polishes the Fund dialog (`BaseFundDialog`), a
  different file, so the overlap is nil.
- **A refusal other than the limit is still reported.** The chip and the
  menu mark it shown and pass it to `reportButtonFailure`, which logs it
  without a second toast.

## Risks / Trade-offs

- An error thrown by `PgTx.confirm` for a network blip now shows faucet
  steps; the faucet route still works then, so the steps are not wrong.
