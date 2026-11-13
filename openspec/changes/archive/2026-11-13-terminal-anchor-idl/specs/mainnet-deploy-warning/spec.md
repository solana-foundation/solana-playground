# Spec Delta

## MODIFIED Requirements

### Requirement: No faucet on mainnet

Where the cluster has no faucet (mainnet, or a custom URL whose cluster
offers none), the wallet menu SHALL show a disabled "This network has no
faucet." where Airdrop would be, and the `airdrop` command SHALL fail with
the same line. Until the cluster is known the menu SHALL show neither, and
`airdrop` SHALL say the network is still loading rather than that it has no
faucet.

#### Scenario: Wallet menu on mainnet (manual)

- **WHEN** the endpoint is mainnet and the user opens the wallet menu
- **THEN** "This network has no faucet." shows, disabled, and no Airdrop

#### Scenario: Terminal airdrop on mainnet (manual)

- **WHEN** the endpoint is mainnet and the user runs `airdrop`
- **THEN** the terminal prints "This network has no faucet."

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

- **WHEN** a profile stored the public mainnet pick under its old key
  `mainnet-beta` before this change, and the deployment configures a platform
  mainnet RPC
- **THEN** Settings opens with "Mainnet" checked and the connection uses the
  platform RPC

### Requirement: Deploys to mainnet are refused

When the `deploy` command starts while the connection's cluster, read from
its endpoint, is mainnet, it SHALL refuse before asking about a wallet
and before sending any transaction, printing one terminal line that says
deploys to mainnet are not available in the beta and to deploy from the
user's own machine with the Solana CLI or Anchor. This SHALL hold for every
caller: the Deploy stage, the terminal, Program Pal and the explorer menu,
and for a custom RPC whose genesis hash is mainnet's. The command SHALL check
again on the connection it sends on, before its first send, so a network
changed to mainnet while a pre-check's question waits is refused too. An
endpoint that does not answer which network it serves SHALL be refused with a
line saying the network could not be read; one whose genesis hash names no
known cluster is not mainnet and SHALL deploy. A tutorial's deploy SHALL refuse
while the network's name is still the previous endpoint's. On every other
cluster the command SHALL deploy as before.

#### Scenario: Terminal deploy on mainnet

- **WHEN** the endpoint is mainnet and the user runs `deploy`
- **THEN** the terminal prints the refusal line and no transaction is sent

#### Scenario: Custom RPC on mainnet (manual)

- **WHEN** the endpoint is a custom URL whose genesis hash is mainnet's and
  `deploy` runs
- **THEN** it is refused the same way

#### Scenario: Network changed during the wallet question (manual)

- **WHEN** `deploy` runs on devnet with no wallet, and the user picks Mainnet
  while "Connect the Playground wallet?" waits, then answers yes
- **THEN** the deploy is refused before any transaction

#### Scenario: Endpoint that does not answer (manual)

- **WHEN** the endpoint is a custom URL that does not answer the genesis read
  and `deploy` runs
- **THEN** the terminal says the network could not be read and nothing is sent

#### Scenario: Devnet deploys (manual)

- **WHEN** the endpoint is devnet and `deploy` runs
- **THEN** no refusal line is printed and the deploy proceeds

### Requirement: The Deploy stage points mainnet to the user's machine

While the connected cluster is mainnet, the Flow's Deploy stage SHALL
say "Deploys to mainnet are not available in the beta." as its line, and its
pill SHALL read "Deploy from your machine" and open the "Deploy from your
machine" dialog with Mainnet picked, built or not. It SHALL show no "Who
pays" line and no "Deploy to mainnet" action. Before the first deploy on
mainnet, the summary's Network row SHALL keep Change.

#### Scenario: Deploy stage on mainnet

- **WHEN** the user picks Mainnet in Settings › Network and opens the Deploy
  stage
- **THEN** "Deploys to mainnet are not available in the beta." shows, no
  "Deploy to mainnet" button is present, and pressing "Deploy from your
  machine" opens the dialog with Mainnet picked

#### Scenario: Deploy stage on devnet

- **WHEN** the endpoint is devnet and the user opens the Deploy stage
- **THEN** "Deploy to devnet" shows and the mainnet line does not

### Requirement: Anchor IDL writes to mainnet are refused

When the `anchor` command runs an `idl` subcommand that sends a transaction
while the endpoint it sends to is mainnet, it SHALL refuse before any
transaction, printing one terminal line that says writing an IDL to mainnet is
not available in the beta and to run `anchor idl` from the user's own machine.
`init`, `upgrade`, `close`, `create-buffer`, `set-buffer-authority`, and
`write-buffer` are the `idl` subcommands that send a transaction; every other
subcommand, and `-h` and `--help`, SHALL run on any network. The cluster SHALL
be read from the endpoint, a custom RPC by its genesis hash, with the check
the `deploy` command uses; an endpoint that does not answer which network it
serves SHALL be refused, and one whose genesis hash names no known cluster
SHALL run. An endpoint changed between that read and the subcommand's first
send SHALL be refused. While such a subcommand runs, a network switch the user
asks for, in Settings or from the Deploy stage, SHALL be refused with a toast
saying an anchor idl command is running. On every other cluster the
subcommands SHALL run as `client-v2-program-idl` requires.

#### Scenario: IDL init on mainnet (manual)

- **WHEN** the endpoint is mainnet and the user runs `anchor idl init`
- **THEN** the terminal prints the refusal line and no transaction is sent

#### Scenario: IDL close on mainnet (manual)

- **WHEN** the endpoint is mainnet and the user runs
  `anchor idl close <PROGRAM_ID>`
- **THEN** the terminal prints the refusal line and no transaction is sent

#### Scenario: IDL fetch on mainnet (manual)

- **WHEN** the endpoint is mainnet and the user runs
  `anchor idl fetch <PROGRAM_ID>`
- **THEN** the terminal prints the program's published IDL, or the line for a
  program without one, and not the mainnet refusal

#### Scenario: Network switch during an IDL write (manual)

- **WHEN** `anchor idl init` runs on devnet and the user picks Mainnet in
  Settings or presses the Deploy stage's "Show Mainnet"
- **THEN** a toast says an anchor idl command is running and the network stays

#### Scenario: IDL write on devnet (manual)

- **WHEN** the endpoint is devnet and the user runs `anchor idl init`
- **THEN** no refusal line is printed and the upload runs
