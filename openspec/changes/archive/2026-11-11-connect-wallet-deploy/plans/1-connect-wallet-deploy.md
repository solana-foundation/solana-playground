# Plan: connect a wallet and deploy from it (HOO-2786)

Goal: tasks 1.1–1.3 of `connect-wallet-deploy`. Inline execution, TDD per step.

## 1.1 Leftover SOL back to the extension (`commands/deploy/deploy.ts`)

1. Tests in `deploy.test.ts` ("a deploy from a standard wallet returns what the Playground wallet has left"):
   success returns `now - before - fee` from the Playground wallet to the extension; a failed deploy returns
   after its buffer close; nothing over the before-balance sends nothing; a failed return prints how much
   stayed and the deploy still succeeds; a Playground deploy never returns. Run, see them fail.
2. Read the Playground wallet's balance before the extension's transfer; `returnLeftover` recomputes what is
   owed at each attempt (a landed first attempt makes a retry send nothing); call it after the buffer is
   settled on every exit: the funding/extend region's own catch, the main catch after `closeAfterFailure`,
   and after success before the cost is read. Run, see them pass.

## 1.2 Two approvals named

1. `DeployRunState.approval: { wallet: string; n: 1 | 2 } | null`, set around the extension's transfer and its
   final deploy/upgrade, cleared after. Test in `deploy.test.ts`.
2. `BaseDeployProgress` adds "Approve in {wallet} ({n} of 2)" under the running step; test.
3. `DeployPayer.name`; `BaseDeploy`'s who-pays line names the extension and adds "{wallet} asks twice: to send
   SOL for the deploy, then to deploy." before a run; tests.

## 1.3 Connect from the wallet chip

1. `makeStandardCurrent(name)` / `disconnectStandard(name)` in `commands/connect`, the same state change as
   `toggleStandardIfNeeded`; tests.
2. `BaseWalletChip`: `owner` (the connected extension), `wallets` (installed), `connect` state
   (`idle | listing | waiting | declined | failed`), `onConnectOpen`, `onConnect`, `onDisconnect`; the list, empty state, waiting and
   declined lines; extension header and "Disconnect {wallet}"; no "Send from your wallet" with an extension.
   Tests in `BaseWalletChip.test.tsx`.
3. `WalletChip` wires them to `PgWallet`; test.

## Gate

`yarn run check` in `client-v2`, `openspec validate --all --strict`, manual devnet check of the deploy through
Playwright is not possible without an extension: the unit tests carry 1.1–1.2, the chip through a Playwright
look at the popover with an injected Wallet Standard wallet if time allows.
