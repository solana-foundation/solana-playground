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

### Requirement: The mainnet warning opens the CLI deploy guide

In the Deploy stage's "Mainnet deploy warning" callout, the body's own words
"deploy from your own machine" SHALL be a link button that opens the CLI
deploy guide on Mainnet. The body's wording SHALL stay the terminal's; no
words are added.

#### Scenario: Guide from the mainnet warning

- **WHEN** the endpoint is mainnet-beta and the user presses "deploy from
  your own machine" in the mainnet warning
- **THEN** the "Deploy from your machine" dialog opens with Mainnet picked

### Requirement: Settings offers five networks

Settings › Network SHALL offer five network chips, "Mainnet", "Devnet",
"Testnet", "Localnet" and "Surfpool", in that order, in the radio group
labelled "Network"; Devnet SHALL be the default. Mainnet, Devnet and Testnet
SHALL each connect to the platform RPC the deployment configures for that
cluster (`REACT_APP_MAINNET_RPC_URL`, `REACT_APP_DEVNET_RPC_URL`,
`REACT_APP_TESTNET_RPC_URL`), or to the cluster's public RPC when none is
configured. Localnet SHALL connect to `http://localhost:8899` and Surfpool to
`http://127.0.0.1:8899`. No chip SHALL read "Mainnet
Beta" or carry "(Platform)". While Mainnet is picked, the line "Deploys with
real SOL" SHALL show under the chips and describe the group; Devnet shows no
line, nor do Testnet, Localnet and Surfpool. An endpoint no chip names (a
custom URL not saved, Playnet) SHALL leave no chip checked and keep its
address.

#### Scenario: Mainnet picked in Settings

- **WHEN** the user picks Mainnet in Settings › Network and opens the
  Deploy stage
- **THEN** "Deploys with real SOL" describes the network chips, and the
  "Mainnet deploy warning" callout shows
- **AND** after picking Devnet the callout is gone

#### Scenario: Five networks are offered, Mainnet first

- **WHEN** the user opens Settings › Network
- **THEN** the "Network" radio group holds the radios "Mainnet", "Devnet",
  "Testnet", "Localnet" and "Surfpool", in that order

#### Scenario: Testnet picked in Settings (manual)

- **WHEN** the user picks Testnet in Settings › Network
- **THEN** the connection moves to Testnet's RPC and the cluster reads as
  testnet

#### Scenario: A stored public pick opens on its chip (manual)

- **WHEN** a profile stored the public Mainnet Beta pick before this change
  and the deployment configures a platform mainnet RPC
- **THEN** Settings opens with "Mainnet" checked and the connection uses the
  platform RPC
