# Proposal

## Why

A deploy to mainnet pays with real SOL, and the client routes that SOL through
the Playground wallet, whose secret key sits in the browser's local storage
where any script running on the page can read it (HOO-867). The buffer and
the program's extension are paid from a Playground wallet even with an
external wallet connected: the deploy command first transfers their cost to
the first Playground wallet; only the final deploy is signed by the external
wallet. Nothing tells the
user this today, so they cannot choose the safer path: deploying from their
own machine.

## What Changes

- The Flow's Deploy stage shows a warning callout whenever the connected
  cluster is mainnet-beta, before and after a build, whatever wallet is
  connected. It says the deploy moves SOL through the Playground wallet kept in
  this browser and recommends deploying from the user's own machine with the
  Solana CLI or Anchor.
- The `deploy` terminal command prints the same warning before it starts on
  mainnet-beta, so a deploy started from the terminal, or from the stage's
  button, leaves the warning in the console too.
- The warning informs; it does not block or ask for confirmation.
- No telemetry events: the Deploy stage and the `deploy` command live in the
  legacy roots (`views/`, `commands/`), outside the measured slices. This
  change adds, renames and removes no events.

## Capabilities

### New Capabilities

- `mainnet-deploy-warning`: what the client tells a user who is about to
  deploy a program to mainnet from the browser.

### Modified Capabilities

None.

## Impact

- `client-v2/src/views/flow/stages/BaseDeploy.tsx`: the callout.
- `client-v2/src/commands/deploy/`: the terminal line and the shared wording.
- `client-v2/e2e/`: one spec for the stage.

Out of scope:

- Removing the intermediary Playground wallet from mainnet deploys, or
  deploying straight from an external wallet: that is the real hardening the
  ticket's title names and needs its own design.
- A confirmation step, a "don't show again" choice, or blocking mainnet
  deploys.
