# Spec Delta

## Purpose

Tells a user who is about to deploy a program to mainnet from the browser that
the deploy pays real SOL through a wallet kept in the page, and points them to
deploying from their own machine instead.

## ADDED Requirements

### Requirement: The Deploy stage warns on mainnet

While the connected cluster is mainnet-beta, the Flow's Deploy stage SHALL show
a warning callout (`role="alert"`, `aria-label="Mainnet deploy warning"`)
above the deploy action, built or not and whatever wallet is connected. It
SHALL say that the deploy moves real SOL through the Playground wallet, whose
key is kept in this browser, and recommend deploying from the user's own
machine with the Solana CLI or Anchor. On any other cluster it SHALL NOT show.
The callout SHALL NOT disable the deploy action or ask for confirmation.

#### Scenario: Deploy stage on mainnet shows the warning

- **WHEN** the endpoint is mainnet-beta and the user opens the Deploy stage
- **THEN** the "Mainnet deploy warning" callout is visible, names the
  Playground wallet and recommends deploying from the user's own machine

#### Scenario: Deploy stage on devnet shows no warning

- **WHEN** the endpoint is devnet and the user opens the Deploy stage
- **THEN** no "Mainnet deploy warning" callout is present

### Requirement: The deploy command warns on mainnet

When the `deploy` command starts on mainnet-beta, it SHALL print the same
warning to the terminal before its "Deploying..." line, whether the user
typed the command or pressed the stage's deploy button. On any other cluster
it SHALL print no such line.

#### Scenario: Terminal deploy on mainnet (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs `deploy` in the
  terminal
- **THEN** the terminal prints the mainnet warning before "Deploying..."
