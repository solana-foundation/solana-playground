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
for deploys", led by an amber status dot, SHALL show under the chips and
describe the group; Devnet shows
no line, nor do Testnet, Localnet and Surfpool. An endpoint no chip names (a
custom URL not saved) SHALL leave no chip checked and keep its address.

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

- **WHEN** a profile stored the public mainnet pick under its old key
  `mainnet-beta` before this change, and the deployment configures a platform
  mainnet RPC
- **THEN** Settings opens with "Mainnet" checked and the connection uses the
  platform RPC

## ADDED Requirements

### Requirement: A stored Playnet network opens on Devnet

A profile whose stored network is Playnet, under the option key `playnet` or as
the address `http://playnet`, SHALL open on Devnet, with the "Devnet" chip
checked and the connection on Devnet's RPC. The Playground SHALL NOT load the
`@solana-playground/playnet` package or read the browser's `/.playnet` folder.

#### Scenario: A stored Playnet network opens on Devnet

- **WHEN** the stored network is Playnet and the page loads
- **THEN** Settings › Network has "Devnet" checked, and the status indicator
  names Devnet
