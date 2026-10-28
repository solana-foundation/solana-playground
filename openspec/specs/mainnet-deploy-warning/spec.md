# mainnet-deploy-warning Specification

## Purpose
Tells a user who is about to deploy a program to mainnet from the browser that
the deploy pays real SOL through a wallet kept in the page, and points them to
deploying from their own machine instead. Says the same where mainnet is
picked, and says plainly that mainnet has no faucet.

## Requirements

### Requirement: The Deploy stage warns on mainnet

While the connected cluster is mainnet-beta, the Flow's Deploy stage SHALL show
a warning callout (`role="alert"`, `aria-label="Mainnet deploy warning"`)
above the deploy action, built or not and whatever wallet is connected. Its
title SHALL read "Mainnet uses real SOL"; its body SHALL say that the deploy
pays from the Playground wallet, whose key is kept in this browser, and
recommend deploying from the user's own machine with the Solana CLI or Anchor.
On any other cluster the callout SHALL NOT show. The callout SHALL NOT
disable the deploy action or ask for confirmation. The deploy action SHALL
name the cluster "mainnet" ("Deploy to mainnet").

#### Scenario: Deploy stage on mainnet shows the warning

- **WHEN** the endpoint is mainnet-beta and the user opens the Deploy stage
- **THEN** the "Mainnet deploy warning" callout is visible, names the
  Playground wallet and recommends deploying from the user's own machine,
  and "Deploy to mainnet" stays pressable

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

### Requirement: Settings offers Mainnet Beta

Settings › Network SHALL list Mainnet Beta among its chips. While a
mainnet-beta chip is picked (the public one, or a platform's), the line
"Deploys with real SOL" SHALL show under the chips and describe the group.
No other chip shows a line.

#### Scenario: Mainnet Beta picked in Settings

- **WHEN** the user picks Mainnet Beta in Settings › Network and opens the
  Deploy stage
- **THEN** "Deploys with real SOL" describes the network chips, and the
  "Mainnet deploy warning" callout shows
- **AND** after picking Devnet the callout is gone

### Requirement: No faucet on mainnet

Where the cluster has no faucet (mainnet-beta, or a custom URL whose cluster
offers none), the wallet menu SHALL show a disabled "This network has no
faucet." where Airdrop would be, and the `airdrop` command SHALL fail with
the same line. Until the cluster is known the menu SHALL show neither, and
`airdrop` SHALL say the network is still loading rather than that it has no
faucet.

#### Scenario: Wallet menu on mainnet (manual)

- **WHEN** the endpoint is mainnet-beta and the user opens the wallet menu
- **THEN** "This network has no faucet." shows, disabled, and no Airdrop

#### Scenario: Terminal airdrop on mainnet (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs `airdrop`
- **THEN** the terminal prints "This network has no faucet."
