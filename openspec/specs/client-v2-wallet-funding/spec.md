# client-v2-wallet-funding Specification

## Purpose

Lets a user move SOL from their own connected wallet into the Playground
wallet, so a deploy can be paid without an airdrop while the Playground wallet
stays the one that deploys.

## Requirements

### Requirement: The account menu offers funding

The account menu SHALL show the item "Fund from a wallet…" whenever a
Playground wallet account exists, and picking it SHALL open the Fund dialog.
The item SHALL be hidden before the Playground wallet has been set up.

#### Scenario: Playground wallet set up

- **WHEN** the user has a Playground wallet and opens the account menu
- **THEN** the menu shows "Fund from a wallet…" in its wallet group

#### Scenario: No Playground wallet yet

- **WHEN** the Playground wallet has not been set up and the user opens the account menu
- **THEN** the menu does not show "Fund from a wallet…"

### Requirement: The Fund dialog sends to the deploying wallet

The dialog, titled "Fund your Playground wallet", SHALL name the receiving
account (its name and short address): the current wallet when it is a
Playground wallet, otherwise the first Playground account, which is the one
`deploy` pays from. Sending SHALL NOT change the current wallet.

#### Scenario: Playground wallet is current (manual)

- **WHEN** "Wallet 2" is the current wallet and the user opens the dialog
- **THEN** the dialog names "Wallet 2" and its short address as the receiver

#### Scenario: An extension is current (manual)

- **WHEN** Phantom is the current wallet and the user opens the dialog
- **THEN** the dialog names the first Playground account as the receiver

### Requirement: The user picks and connects the paying wallet in the dialog

The dialog SHALL list every detected wallet, each as a button labelled
`Connect <wallet name>` with the wallet's icon, and show the connected one with
its short address and SOL balance. With no wallet detected it SHALL say
"No wallet extension found in this browser." and suggest installing one;
while a wallet is asked to connect, its button SHALL read
`Waiting for <wallet name>…`. A wallet connected here SHALL NOT
become the current wallet.

#### Scenario: Connect in the dialog (manual)

- **WHEN** the user presses `Connect Phantom` and approves in Phantom
- **THEN** the dialog shows Phantom's short address and balance, and the current wallet is unchanged

#### Scenario: No wallet installed

- **WHEN** no Wallet Standard wallet is detected
- **THEN** the dialog shows "No wallet extension found in this browser." and no amount field

#### Scenario: The user declines the connection

- **WHEN** the user rejects the connection request in the wallet
- **THEN** the dialog stays open, lists the wallets again and says "You declined in Phantom. Nothing was sent."

### Requirement: The amount is checked before the wallet is asked

The amount field (label "Amount (SOL)", id `fund-amount`) SHALL start at 1 and
accept a positive number of SOL with at most 9 decimals. The send button,
labelled `Send <amount> SOL`, SHALL be disabled while the amount is not valid
or exceeds the paying wallet's balance less 0.001 SOL for fees, and while that
balance is unknown. The field SHALL name the Playground's cluster the SOL goes
to, and the balance SHALL be read again when that cluster changes.

#### Scenario: Amount above the balance

- **WHEN** the paying wallet holds 0.5 SOL and the user enters 1
- **THEN** the send button is disabled and the field says the wallet holds 0.5 SOL

#### Scenario: Not a number (manual)

- **WHEN** the user enters `abc`, `0` or `-1`
- **THEN** the send button is disabled and the field asks for an amount above 0

#### Scenario: Mainnet (manual)

- **WHEN** the Playground is on mainnet-beta and a paying wallet is connected
- **THEN** a warning Callout titled "Mainnet uses real SOL" shows above the send button

### Requirement: Sending is one transfer approved in the wallet

Pressing send SHALL build one System Program transfer of the amount from the
paying wallet to the receiving account on the cluster the Playground is
connected to, ask the paying wallet to sign it, send it, and wait for
confirmation. On success the dialog SHALL close and a toast SHALL say
`Sent <amount> SOL to <receiver name>.`; the Playground wallet's balance
updates on its own.

#### Scenario: Successful funding

- **WHEN** the user sends 1 SOL from Phantom and approves
- **THEN** the receiving account's balance rises by 1 SOL, the dialog closes and the toast says `Sent 1 SOL to Wallet 1.`

#### Scenario: The user declines the transfer

- **WHEN** the user rejects the signature request in the wallet
- **THEN** nothing is sent, the dialog stays open with the amount kept, and it says "You declined in <wallet name>. Nothing was sent."

#### Scenario: The transfer fails on the network (manual)

- **WHEN** the transaction never reaches the cluster, or the cluster runs it and it fails
- **THEN** the dialog stays open, shows "Could not send." with the reason, and the send button can be pressed again

#### Scenario: The transfer is sent but not confirmed (manual)

- **WHEN** the transaction was sent and its confirmation times out or fails
- **THEN** the dialog shows "Sent, not confirmed yet." with the signature and "Check it in Explorer before you send again.", and the send button stays disabled so the SOL cannot be sent twice

### Requirement: Funding is measured

The `features/fund-wallet` slice SHALL emit, with prefix `fund`:
`fund_dialog_opened` `{ via: "account-menu" }` when the dialog opens;
`fund_wallet_connected` `{ wallet: string }` (the wallet's name) when a wallet
connects in the dialog; `fund_sent` `{ cluster: "mainnet-beta" | "devnet" | "testnet" | "localnet" | "playnet" }` (the Playground's cluster) when a
transfer is confirmed; and
`fund_failed` `{ stage: "connect" | "send", reason: "rejected" | "network" | "unconfirmed" | "unknown" }` when connecting or sending fails. `session_account_item_picked`
SHALL carry `item: "fund-wallet"` when the menu item is picked. No event
carries an address or an amount.

#### Scenario: A confirmed transfer is counted (manual)

- **WHEN** a transfer is confirmed on devnet
- **THEN** `fund_sent` is emitted once with `cluster: "devnet"`

#### Scenario: A declined signature is counted (manual)

- **WHEN** the user rejects the transfer in the wallet
- **THEN** `fund_failed` is emitted once with `stage: "send"` and `reason: "rejected"`

### Requirement: Max fills the sendable balance
The amount field SHALL carry a `Max` button at its end. Pressing it SHALL set
the amount to the paying wallet's balance less 0.001 SOL for fees, written
with at most 9 decimals, so the send button is enabled on it. `Max` SHALL be
disabled while the balance is unknown or unreadable, and when the balance is
0.001 SOL or less.

#### Scenario: Max then send
- **WHEN** the paying wallet holds 2 SOL and the user presses Max
- **THEN** the amount reads `1.999`, and pressing `Send 1.999 SOL` transfers 1.999 SOL

#### Scenario: Balance below the fee
- **WHEN** the paying wallet holds 0.0005 SOL
- **THEN** the Max button is disabled

#### Scenario: Balance loading (manual)
- **WHEN** the paying wallet's balance is still being read
- **THEN** the Max button is disabled

### Requirement: Airdrops go through the cluster's native RPC

Every Playground airdrop (the `airdrop` command, the wallet menu's Airdrop, the automatic airdrop, a deploy's top-up
and a tutorial's funding) SHALL request SOL from the cluster's native RPC, the URL
`REACT_APP_DEVNET_READ_BUFFER_RPC_URL`, `REACT_APP_TESTNET_READ_BUFFER_RPC_URL` or
`REACT_APP_MAINNET_READ_BUFFER_RPC_URL` sets, and SHALL confirm the airdrop's signature on that same RPC. An unset or
empty value, or an endpoint on no cluster the env configures, SHALL use the selected RPC.

#### Scenario: Devnet with a platform RPC (manual)

- **WHEN** devnet is selected through a platform RPC, `REACT_APP_DEVNET_READ_BUFFER_RPC_URL` is
  `https://api.devnet.solana.com`, and the person runs `airdrop 1` or picks Airdrop in the wallet menu
- **THEN** the `requestAirdrop` request goes to `api.devnet.solana.com`, not to the platform RPC

#### Scenario: Localnet (manual)

- **WHEN** Localnet is selected and the person runs `airdrop 1`
- **THEN** the `requestAirdrop` request goes to the local validator

### Requirement: An airdrop's balance is read where the airdrop is measured

The `airdrop` command SHALL read the wallet's balance before and after the airdrop on the RPC that took the airdrop,
and SHALL report what arrived from those two reads. A tutorial's funding check, which decides whether a deploy is
funded, SHALL read the balance on the selected RPC.

#### Scenario: The terminal reports what arrived (manual)

- **WHEN** `airdrop 1` lands on devnet through the native RPC while the platform RPC lags a slot behind
- **THEN** the terminal prints the amount received, read from the native RPC

### Requirement: A closed RPC faucet points to the web faucet

When an airdrop's RPC refuses it as closed (HTTP or JSON-RPC 410, "The RPC faucet is closed on this cluster"), the
`airdrop` command SHALL end with one line, in place of the RPC's answer, that links
`https://faucet.solana.com/?walletAddress=<wallet>&cluster=<cluster>`. The wallet menu's Airdrop, the Interact
stage's airdrop and the automatic airdrop SHALL show that line through the command. A deploy's funding card and a
tutorial's "Not enough devnet SOL" card SHALL say the RPC faucet is closed and keep their "Open faucet" link.

#### Scenario: `airdrop 1` on devnet while the faucet is closed (manual)

- **WHEN** devnet's RPC faucet is closed and the person runs `airdrop 1`
- **THEN** the terminal prints "Airdropping 1 SOL..." and then
  "The devnet RPC faucet is closed. Request test SOL at https://faucet.solana.com/?walletAddress=<wallet>&cluster=devnet",
  and no JSON

#### Scenario: A tutorial airdrop on a closed faucet (manual)

- **WHEN** a tutorial's airdrop card is pressed and devnet's RPC faucet is closed
- **THEN** the "Not enough devnet SOL" card says the devnet RPC faucet is closed and links the web faucet

### Requirement: A closed RPC faucet is not asked again unasked

After the `airdrop` command finds an airdrop RPC closed, the automatic airdrop and the editor's deploy top-up (the
`deploy` command and the Deploy stage) SHALL NOT request an airdrop from that RPC again in the same session: the
automatic airdrop SHALL print the faucet line once, and a deploy SHALL stop at its funding card, or end a typed
deploy, with that line. The `airdrop` command SHALL still request one, and an airdrop that lands SHALL clear the
answer. The answer SHALL live in memory only, and an RPC that never answered closed (localnet, a custom endpoint that
airdrops through itself) SHALL be asked as before. A tutorial's funding SHALL ask the faucet each time.

#### Scenario: The automatic airdrop after a closed answer (manual)

- **WHEN** `airdrop 1` found devnet's RPC faucet closed and the wallet's balance then changes below the airdrop amount
- **THEN** the terminal prints the faucet line once, and no `requestAirdrop` request is sent

#### Scenario: The command asks again (manual)

- **WHEN** `airdrop 1` found devnet's RPC faucet closed and the person runs `airdrop 1` again
- **THEN** a `requestAirdrop` request is sent
