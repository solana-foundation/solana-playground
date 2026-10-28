# Spec Delta

## Purpose

Lets a user move SOL from their own connected wallet into the Playground
wallet, so a deploy can be paid without an airdrop while the Playground wallet
stays the one that deploys.

## ADDED Requirements

### Requirement: The account menu offers funding
The account menu SHALL show the item "Fund from a wallet" whenever a
Playground wallet account exists, and picking it SHALL open the Fund dialog.
The item SHALL be hidden before the Playground wallet has been set up.

#### Scenario: Playground wallet set up
- **WHEN** the user has a Playground wallet and opens the account menu
- **THEN** the menu shows "Fund from a wallet" in its wallet group

#### Scenario: No Playground wallet yet
- **WHEN** the Playground wallet has not been set up and the user opens the account menu
- **THEN** the menu does not show "Fund from a wallet"

### Requirement: The Fund dialog sends to the deploying wallet
The dialog, titled "Fund the Playground wallet", SHALL name the receiving
account (its name and short address): the current wallet when it is a
Playground wallet, otherwise the first Playground account, which is the one
`deploy` pays from. Sending SHALL NOT change the current wallet.

#### Scenario: Playground wallet is current
- **WHEN** "Wallet 2" is the current wallet and the user opens the dialog
- **THEN** the dialog names "Wallet 2" and its short address as the receiver

#### Scenario: An extension is current
- **WHEN** Phantom is the current wallet and the user opens the dialog
- **THEN** the dialog names the first Playground account as the receiver

### Requirement: The user picks and connects the paying wallet in the dialog
The dialog SHALL list every detected wallet, each as a button labelled
`Connect <wallet name>` with the wallet's icon, and show the connected one with
its short address and SOL balance. With no wallet detected it SHALL say
"No wallet found" and suggest installing one. A wallet connected here SHALL NOT
become the current wallet.

#### Scenario: Connect in the dialog
- **WHEN** the user presses `Connect Phantom` and approves in Phantom
- **THEN** the dialog shows Phantom's short address and balance, and the current wallet is unchanged

#### Scenario: No wallet installed
- **WHEN** no Wallet Standard wallet is detected
- **THEN** the dialog shows "No wallet found" and no amount field

#### Scenario: The user declines the connection
- **WHEN** the user rejects the connection request in the wallet
- **THEN** the dialog stays open, lists the wallets again and says the connection was declined

### Requirement: The amount is checked before the wallet is asked
The amount field (label "Amount (SOL)", id `fund-amount`) SHALL start at 1 and
accept a positive number of SOL with at most 9 decimals. The send button,
labelled `Send <amount> SOL`, SHALL be disabled while the amount is not valid
or exceeds the paying wallet's balance less 0.001 SOL for fees.

#### Scenario: Amount above the balance
- **WHEN** the paying wallet holds 0.5 SOL and the user enters 1
- **THEN** the send button is disabled and the field says the wallet holds 0.5 SOL

#### Scenario: Not a number
- **WHEN** the user enters `abc`, `0` or `-1`
- **THEN** the send button is disabled and the field asks for an amount above 0

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
- **THEN** nothing is sent, the dialog stays open with the amount kept, and it says the transfer was declined

#### Scenario: The transfer fails on the network
- **WHEN** the cluster rejects the transaction or it is not confirmed
- **THEN** the dialog stays open, shows "Couldn't send the SOL." with the reason, and the send button can be pressed again

### Requirement: Funding is measured
The `features/fund-wallet` slice SHALL emit, with prefix `fund`:
`fund_dialog_opened` `{ from: "account-menu" }` when the dialog opens;
`fund_wallet_connected` `{ wallet: string }` (the wallet's name) when a wallet
connects in the dialog; `fund_sent` `{ cluster: "mainnet-beta" | "devnet" |
"testnet" | "localnet" | "playnet" }` (the Playground's cluster) when a
transfer is confirmed; and
`fund_failed` `{ stage: "connect" | "send", reason: "rejected" | "network" |
"unknown" }` when connecting or sending fails. `session_account_item_picked`
SHALL carry `item: "fund-wallet"` when the menu item is picked. No event
carries an address or an amount.

#### Scenario: A confirmed transfer is counted
- **WHEN** a transfer is confirmed on devnet
- **THEN** `fund_sent` is emitted once with `cluster: "devnet"`

#### Scenario: A declined signature is counted
- **WHEN** the user rejects the transfer in the wallet
- **THEN** `fund_failed` is emitted once with `stage: "send"` and `reason: "rejected"`
