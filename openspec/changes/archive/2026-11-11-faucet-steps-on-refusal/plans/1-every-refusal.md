# Plan: every refused airdrop points to the web faucet (tasks 1.1–1.4)

Goal: one notion of a refused airdrop, the cause in words true to it, and the
three web-faucet steps with a prefilled link on every surface.

## 1.1 Terminal (`commands/airdrop`)

1. Test first (`report.test.ts`): `refusedNote` for a 429 and for "fetch
   failed" gives the cause line, three numbered steps and a link with the
   address, cluster and an offered amount; an unoffered amount (3) falls back
   to 5. `isAirdropRefused` is true for `AirdropRefusedError`, false for a
   plain `Error`.
2. `report.ts`: `AirdropRefusedError` (name brand, `cause`), `isAirdropRefused`,
   `refusedNote(error, fill)` replacing `rateLimitNote`.
3. `airdrop.ts`: the request-phase catch prints `refusedNote` for any error
   and throws `AirdropRefusedError` with the same message.
4. `airdrop-run.test.ts`: a non-limit refusal prints the
   note; a local validator gets none; `airdrop.test.ts`: no faucet is not a refusal.

## 1.2 Wallet chip and wallet menu

1. `BaseWalletChip`: `refusedFor: AirdropRefusal` (required) picks the headline;
   the type and `refusalOf` live in `commands/airdrop/report.ts`.
2. `WalletChip`: `isAirdropRefused` opens the refused state; telemetry reason
   from `isRateLimited`; a non-limit refusal is still logged through
   `reportButtonFailure` after `markFailureShown`.
3. `FaucetRefusedToast`: `refusal: AirdropRefusal` picks its headline; `Settings.tsx`
   shows it for any refusal.
4. Tests: chip test for a non-limit refusal (popover, no toast, event
   `failed`).

## 1.3 Tutorial run/call card

`BaseTxResultCard` FundsCard: cause line from `result.message` through a
shared `airdropCause` in `shared/lib/faucet-limit.ts` (moved from `BaseDeployResultCard`). Test for
a non-limit message.

## 1.4 Assistant context

"Getting SOL" in `docs/assistant-context.md`; `yarn sync-assistant-context`;
the sync check test stays green.

## Gate

`yarn run check` in `client-v2`; no e2e spec is added or changed.
