# Proposal

## Why

A deploy from the Flow's Deploy stage stops in the terminal twice: it asks
there whether to request an airdrop and whether to deploy the binary of an
earlier build when the last build failed, and it never shows the newcomer
which step is running. The result card shows no cost and does not say a
redeploy upgraded the program, and the history's Explorer links open the
network picked now rather than the record's
([HOO-2385](https://linear.app/solana-fndn/issue/HOO-2385)). Designers'
Spec 03 asks for a deploy run from the panel end to end; Kora, which that
spec assumes pays on devnet, is not built, so this change follows the wallet
path the tutorial flow already chose (`tutorial-flow-v2`, decisions D6 and
D8): the Playground wallet pays, and funding it is a stage of the deploy.

## What Changes

- Deploying from the stage needs no dialog: with no Playground wallet,
  pressing Deploy creates one first.
- The stage shows the run as steps: "Funding wallet" (only when the wallet
  holds less than the deploy needs), "Preparing buffer", "Writing program,
  N%", "Deploying".
- A deploy started from the stage tops the wallet up by airdrop without
  asking. A refused airdrop stops the run with a "Not enough devnet SOL"
  card: balance, cost, wallet address, "Try again", "Open faucet", and, when
  signed out, a sign-in line.
- When the last build failed, the stage asks in a dialog before deploying
  the last successful build. A deploy typed in the terminal keeps its
  terminal questions.
- The result card reads "Deployed to {network}" or, on an upgrade,
  "Upgraded. The program id stays the same.", with the cost in SOL, the
  short program id with copy, and "View on Explorer ({network})".
- The first deploy a Playground wallet pays for shows a backup line under
  the result: "Save keypair" downloads the wallet's keypair, "Not now" hides
  the line for that wallet.
- Each history record keeps its deploy signature and cost, and its Explorer
  links open the record's network.
- The assistant's approval cards ask "Deploy {program} to {network}? It
  costs about {cost} SOL." and "Build {program}?".
- The deploy command's "Program ID not found" error stops pointing at the
  removed "Build & Deploy" tab.
- Telemetry: a new slice `features/deploy` adds `deploy_started`,
  `deploy_succeeded`, `deploy_failed`, `deploy_sol_needed_shown`,
  `deploy_backup_shown`, `deploy_backup_saved` and
  `deploy_backup_dismissed`. `widgets/assistant` changes no events.

## Capabilities

### New Capabilities

- `client-v2-deploy`: the Flow's Deploy stage: who pays, the run's steps,
  the funding and failed-build questions, the result card, the backup line,
  the history and its Explorer links, and the deploy events.

### Modified Capabilities

None. `mainnet-deploy-warning` keeps its requirements: on mainnet the stage
never funds by airdrop (there is no faucet), so its warning stays the only
mainnet behaviour.

## Impact

- Code: `client-v2/src/commands/deploy/` (progress reporting, panel answers,
  cost), `client-v2/src/block-explorers/` and `utils/block-explorer.ts` (a
  link for a given cluster), `views/flow/stages/` (Deploy, BaseDeploy),
  `views/flow/state/deploy-history.ts` (signature, cost), new
  `features/deploy/`, `widgets/assistant/ui/BaseApprovalCard.tsx`,
  `views/sidebar/assistant/model/tools.ts`.
- Storage: deploy records in `localStorage` (`flow.deploys`) gain
  `signature` values and a `cost`; records written before this change still
  read, with no cost shown. The backup line's "Not now" is kept per wallet
  address in `localStorage`.
- Out of scope: Kora and its closing dates, Cancel in the panel, the
  second-tab lock, closed-program detection, Interact
  ([HOO-2386](https://linear.app/solana-fndn/issue/HOO-2386)), tutorial
  deploys ([HOO-2356](https://linear.app/solana-fndn/issue/HOO-2356)).
