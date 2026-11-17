# Proposal

## Why

A wallet extension can be connected only from the terminal (`connect phantom`). A deploy from it already
runs the two-transaction path: the extension sends SOL to the Playground wallet, which writes the buffer,
and the extension signs the final deploy or upgrade, so it owns the program. But nothing in the interface
offers it, nothing says the extension will ask twice, and the SOL the Playground wallet did not spend stays
there instead of going back to the wallet that paid.

Sergey, on the wallet doc (10 Nov): the two-transaction wrapper is fine, Kora comes later, and the leftover
SOL must go back to the wallet that funded the buffer. Deploying from a connected wallet makes it the
owner (7 Nov).

## What Changes

- **Connect from the wallet chip.** The chip's popover offers "Connect a wallet" with the installed
  extensions. Connected, the popover names the extension, shows its address and balance, and offers
  "Disconnect {wallet}", which brings the Playground wallet back. The terminal's `connect` keeps working.
- **Two approvals, named.** With an extension current, the Deploy stage says who pays by name ("From
  Phantom · …") and that the extension asks twice: once to send the SOL for the deploy, once to deploy.
  While the run waits on the extension, the running step says "Approve in Phantom (1 of 2)" or "(2 of 2)".
- **Leftover SOL goes back.** After a deploy from an extension, whatever it ends with — success, failure,
  stop or cancel — the Playground wallet sends back what it holds over its balance before the run, once
  the buffer is settled, so a closed buffer's rent goes back too. A return that fails says how much stayed
  in the Playground wallet; it never fails the deploy.
- **Tutorials keep the Playground wallet.** Their deploy path already signs with a Playground account
  (`playgroundWallet()` in `real-deploy.ts`); nothing changes there.

## Capabilities

### Modified Capabilities

- `client-v2-wallet-funding`: the wallet chip connects and disconnects an extension wallet.
- `client-v2-deploy`: the stage names the connected payer and its two approvals; a deploy from an
  extension returns its leftover SOL.

## Impact

- Code: `features/fund-wallet` (`BaseWalletChip`, `WalletChip`), `commands/deploy` (`deploy.ts`, `run.ts`),
  `features/deploy/ui/BaseDeployProgress.tsx`, `views/flow/stages` (`BaseDeploy`, `Deploy`).
- Out of scope: moving a program's authority off the Playground wallet (HOO-2292), Kora, a connect dialog
  on a phone, mobile wallet adapters.
