## ADDED Requirements

### Requirement: Deploys to mainnet are refused

When the `deploy` command starts while the connection's cluster, read from
its endpoint, is mainnet-beta, it SHALL refuse before asking about a wallet
and before sending any transaction, printing one terminal line that says
deploys to mainnet are not available in the beta and to deploy from the
user's own machine with the Solana CLI or Anchor. This SHALL hold for every
caller: the Deploy stage, the terminal, Program Pal and the explorer menu,
and for a custom RPC whose genesis hash is mainnet's. On every other cluster
the command SHALL deploy as before.

#### Scenario: Terminal deploy on mainnet

- **WHEN** the endpoint is mainnet-beta and the user runs `deploy`
- **THEN** the terminal prints the refusal line and no transaction is sent

#### Scenario: Custom RPC on mainnet

- **WHEN** the endpoint is a custom URL whose genesis hash is mainnet's and
  `deploy` runs
- **THEN** it is refused the same way

#### Scenario: Devnet deploys

- **WHEN** the endpoint is devnet and `deploy` runs
- **THEN** no refusal line is printed and the deploy proceeds

### Requirement: The Deploy stage points mainnet to the user's machine

While the connected cluster is mainnet-beta, the Flow's Deploy stage SHALL
say "Deploys to mainnet are not available in the beta." as its line, and its
pill SHALL read "Deploy from your machine" and open the "Deploy from your
machine" dialog with Mainnet picked, built or not. It SHALL show no "Who
pays" line and no "Deploy to mainnet" action. The summary's Network row SHALL
keep Change.

#### Scenario: Deploy stage on mainnet

- **WHEN** the user picks Mainnet in Settings › Network and opens the Deploy
  stage
- **THEN** "Deploys to mainnet are not available in the beta." shows, no
  "Deploy to mainnet" button is present, and pressing "Deploy from your
  machine" opens the dialog with Mainnet picked

#### Scenario: Deploy stage on devnet

- **WHEN** the endpoint is devnet and the user opens the Deploy stage
- **THEN** "Deploy to devnet" shows and the mainnet line does not

## MODIFIED Requirements

### Requirement: Settings offers five networks

Settings › Network SHALL offer five network chips, "Mainnet", "Devnet",
"Testnet", "Localnet" and "Surfpool", in that order, in the radio group
labelled "Network"; Devnet SHALL be the default. Mainnet, Devnet and Testnet
SHALL each connect to the platform RPC the deployment configures for that
cluster (`REACT_APP_MAINNET_RPC_URL`, `REACT_APP_DEVNET_RPC_URL`,
`REACT_APP_TESTNET_RPC_URL`), or to the cluster's public RPC when none is
configured. Localnet SHALL connect to `http://localhost:8899` and Surfpool to
`http://127.0.0.1:8899`. No chip SHALL read "Mainnet
Beta" or carry "(Platform)". While Mainnet is picked, the line "Not available
for deploys" SHALL show under the chips and describe the group; Devnet shows
no line, nor do Testnet, Localnet and Surfpool. An endpoint no chip names (a
custom URL not saved, Playnet) SHALL leave no chip checked and keep its
address.

#### Scenario: Mainnet picked in Settings

- **WHEN** the user picks Mainnet in Settings › Network and opens the
  Deploy stage
- **THEN** "Not available for deploys" describes the network chips, and the
  stage says deploys to mainnet are not available in the beta
- **AND** after picking Devnet the stage offers "Deploy to devnet"

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

## REMOVED Requirements

### Requirement: The Deploy stage warns on mainnet

**Reason**: Mainnet deploys are refused in the beta; a warning before a
deploy that cannot run has nothing to warn about.
**Migration**: "The Deploy stage points mainnet to the user's machine".

### Requirement: The deploy command warns on mainnet

**Reason**: The command refuses on mainnet instead.
**Migration**: "Deploys to mainnet are refused".

### Requirement: The mainnet warning opens the CLI deploy guide

**Reason**: The warning is gone; the stage's pill opens the guide on Mainnet.
**Migration**: "The Deploy stage points mainnet to the user's machine".
