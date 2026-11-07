## Why

Sergey Prokhorov does not want paid mainnet deploys from the Playground wallet
in the beta, whose key lives in the browser (answers to the open questions,
7 Nov; Slava agreed 7 Nov 23:28). Today a mainnet deploy is allowed behind a
warning. The beta deploys to devnet, testnet and local networks; mainnet
deploys go through the user's own machine. Ticket: HOO-2728.

## What Changes

- The `deploy` command refuses when the connection's cluster is mainnet-beta,
  read from the endpoint itself (so a custom RPC whose genesis hash is
  mainnet's is refused too), before its wallet check and before any
  transaction. Every caller goes through it: the Deploy stage, the terminal,
  Program Pal and the explorer menu.
- On Mainnet the Deploy stage says "Deploys to mainnet are not available in
  the beta." in its line, and its pill is "Deploy from your machine", opening
  the CLI deploy guide on Mainnet. No "Who pays" line, and no separate
  "Deploy with the CLI" outline on Mainnet (the pill is that button).
- Settings › Network: the Mainnet chip's line reads "Not available for
  deploys" instead of "Deploys with real SOL".
- **BREAKING (spec):** the "Mainnet uses real SOL" warning callout and its
  terminal line are removed; nothing reaches them once the deploy is refused.
- Telemetry: `cli_guide_opened`'s `from` value `mainnet-warning` is renamed
  `mainnet-blocked`. No other event is added, renamed or removed. Funnel
  events: `deploy_started` / `deploy_succeeded` / `deploy_failed` are kept
  unchanged; on Mainnet the stage never starts a deploy, so none fires with
  `cluster: "mainnet-beta"`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mainnet-deploy-warning`: the warning requirements become a refusal; the
  Settings line changes.
- `cli-deploy`: the guide opens on Mainnet from the stage's refusal; the
  stage's outline button is not shown on Mainnet; the `cli_guide_opened`
  source value is renamed.

## Impact

- Code: `client-v2/src/commands/deploy/` (the command and its mainnet
  module), `views/flow/stages/BaseDeploy.tsx` and `Deploy.tsx`,
  `features/cli-deploy` (guide source type), `widgets/settings-page`
  (network chip line). Unit tests beside each, one e2e spec.
- Out of scope: mainnet stays selectable for reading, Interact and the
  wallet (HOO-2707); the airdrop's "no faucet" line is unchanged; IDL upload,
  `sugar` and the stubbed `solana`/`anchor` terminal commands are untouched.
