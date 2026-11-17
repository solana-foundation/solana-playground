# Proposal

## Why

An airdrop refused for a reason other than the devnet faucet's limit (a 429
or its limit words) gives no way forward: the terminal prints only the error,
the wallet chip and the wallet menu toast "Could not airdrop.", and the
tutorial's run/call card says "The devnet faucet is at its limit." whatever
the cause. On the 10 Nov call Slava asked that every refusal say explicitly
how to get SOL from the web faucet, and that the assistant know it too
(HOO-2788).

## What Changes

- The `airdrop` command marks a failure of the request itself (the RPC call,
  its confirmation, a balance that never moved) as a refusal,
  `AirdropRefusedError`, with the same message. Failures before the faucet is
  asked (no wallet, sign-in, no faucet on this cluster, network not read) are
  not refusals.
- Terminal: every refusal prints the cause line ("at its limit for now" or
  "did not send SOL"), the three web-faucet steps (`webFaucetSteps`, #490) and
  the prefilled link. Replaces the limit-only one-liner.
- Wallet chip: any refusal opens the popover's refused state with the steps;
  the headline names the cause ("The faucet is at its limit" or "The faucet
  did not send SOL"). Wallet menu: any refusal shows `FaucetRefusedToast`,
  headline by cause.
- Tutorial run/call "Not enough devnet SOL" card: the cause line follows the
  airdrop's message, as the deploy card already does.
- The deploy's low-balance prompt already shows the steps for any refused
  airdrop (`airdrop_failed`); unchanged.
- `docs/assistant-context.md` gets "Getting SOL": airdrop, the web faucet's
  steps and link shape, the public-repo condition, "Fund from a wallet". The
  assistant explains; it has no airdrop tool (Sergey, 10 Nov).
- Telemetry: no event added, renamed or removed. `fund_airdrop_refused`
  keeps `reason: "rate-limited" | "failed"`; the chip now emits `failed` for a
  refusal it shows in the popover, as before for one it toasted. No funnel
  event changes.

## Capabilities

### New Capabilities

### Modified Capabilities

- `client-v2-wallet-funding`: a requirement that every refused airdrop shows
  the web faucet's steps and link, on every surface, and one for the
  assistant's "Getting SOL" context.

## Impact

- `commands/airdrop/report.ts`, `airdrop.ts`; `shared/lib/faucet.ts`,
  `faucet-limit.ts`; `features/fund-wallet/ui/WalletChip.tsx`,
  `BaseWalletChip.tsx`, `FaucetRefusedToast.tsx` (one prop each, not the Fund
  dialog that HOO-2787 polishes); `components/Wallet/Settings.tsx`;
  `widgets/tutorial-conversation/ui/BaseTxResultCard.tsx`;
  `docs/assistant-context.md` and its synced copy.
- Out of scope: an airdrop tool for the assistant; a Playground faucet of its
  own; the automatic airdrop's note; connecting a wallet (HOO-2786); the Fund
  dialog (HOO-2787).
