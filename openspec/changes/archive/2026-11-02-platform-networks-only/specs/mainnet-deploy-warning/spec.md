## REMOVED Requirements

### Requirement: Settings offers Mainnet Beta

**Reason**: The public RPCs rate-limit a shared app; only the platform's
Devnet and Mainnet stay, and the cluster is called Mainnet (HOO-2488).
**Migration**: See "Settings offers Devnet and Mainnet".

## ADDED Requirements

### Requirement: Settings offers Devnet and Mainnet

Settings › Network SHALL offer exactly two network chips, "Devnet" and
"Mainnet", in that order, in the radio group labelled "Network". Each SHALL
connect to the platform RPC the deployment configures for that cluster, or to
the cluster's public RPC when none is configured. No chip SHALL read "Mainnet
Beta" or carry "(Platform)". While Mainnet is picked, the line "Deploys with
real SOL" SHALL show under the chips and describe the group; Devnet shows no
line. An endpoint neither chip names (a custom URL, Testnet, Localnet,
Playnet) SHALL leave no chip checked and keep its address.

#### Scenario: Mainnet picked in Settings

- **WHEN** the user picks Mainnet in Settings › Network and opens the
  Deploy stage
- **THEN** "Deploys with real SOL" describes the network chips, and the
  "Mainnet deploy warning" callout shows
- **AND** after picking Devnet the callout is gone

#### Scenario: Only Devnet and Mainnet are offered

- **WHEN** the user opens Settings › Network
- **THEN** the "Network" radio group holds exactly the radios "Devnet" and
  "Mainnet"

#### Scenario: A stored public pick opens on its chip (manual)

- **WHEN** a profile stored the public Mainnet Beta pick before this change
  and the deployment configures a platform mainnet RPC
- **THEN** Settings opens with "Mainnet" checked and the connection uses the
  platform RPC
