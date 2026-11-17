## MODIFIED Requirements

### Requirement: The amount is checked before the wallet is asked

The amount field (label "Amount (SOL)", id `fund-amount`) SHALL start at 0
and accept a positive number of SOL with at most 9 decimals. The arrow keys
and the field's − and + buttons SHALL step the amount by 0.1 SOL, to the next
multiple of 0.1 in that direction and never below 0. The send button,
labelled `Send <amount> SOL`, SHALL be disabled while the amount is not valid
or exceeds the paying wallet's balance less 0.001 SOL for fees, and while that
balance is unknown. At 0 the field SHALL ask for an amount above 0 as a hint,
not an error. A valid amount SHALL be noted as `Arrives in <receiver name> on
<network>.`, naming the Playground's cluster, and the balance SHALL be read
again when that cluster changes.

#### Scenario: The field starts at 0

- **WHEN** the user connects a paying wallet
- **THEN** the amount reads `0`, the send button is disabled and the field says "Enter an amount above 0." without an error

#### Scenario: Stepping by 0.1

- **WHEN** the amount reads `0` and the user presses + and then the up arrow
- **THEN** the amount reads `0.2`, and from `1.999` the up arrow gives `2` and the down arrow `1.9`

#### Scenario: Amount above the balance

- **WHEN** the paying wallet holds 0.5 SOL and the user enters 1
- **THEN** the send button is disabled and the field says the wallet holds 0.5 SOL

#### Scenario: Not a number (manual)

- **WHEN** the user enters `abc` or `-1`
- **THEN** the send button is disabled and the field asks for an amount above 0

#### Scenario: Where the SOL goes

- **WHEN** the Playground is on devnet and the amount is valid
- **THEN** the field says `Arrives in Wallet 1 on devnet.`

#### Scenario: Mainnet (manual)

- **WHEN** the Playground is on mainnet and a paying wallet is connected
- **THEN** a warning Callout titled "Mainnet uses real SOL" shows above the send button

### Requirement: Funding is measured

The `features/fund-wallet` slice SHALL emit, with prefix `fund`:
`fund_dialog_opened` `{ via: "account-menu" | "wallet-chip" | "deploy-card" | "tutorial-card" | "faucet-toast" }` (the control that opened it) when the dialog opens;
`fund_wallet_connected` `{ wallet: string, as: "payer" | "current" }` (the wallet's name; `payer` when it
connects in the dialog, `current` when the wallet chip makes it the current wallet);
`fund_wallet_connect_started` `{ wallet: string }` when the wallet chip asks a wallet to connect;
`fund_wallet_connect_failed` `{ wallet: string, reason: "rejected" | "network" | "unconfirmed" | "unknown" }`
when that connect does not happen (`rejected` is the user's no); `fund_wallet_disconnected` `{ wallet: string }`
when the chip disconnects the current wallet; `fund_sent` `{ cluster: "mainnet" | "devnet" | "testnet" | "localnet" | "playnet" }` (the Playground's cluster) when a
transfer is confirmed; and
`fund_failed` `{ stage: "connect" | "send", reason: "rejected" | "network" | "unconfirmed" | "unknown" }` when connecting or sending fails. `session_account_item_picked`
SHALL carry `item: "fund-wallet"` when the menu item is picked. No event
carries an address or an amount.

#### Scenario: A confirmed transfer is counted (manual)

- **WHEN** a transfer is confirmed on devnet
- **THEN** `fund_sent` is emitted once with `cluster: "devnet"`

#### Scenario: A transfer on Mainnet is counted as mainnet (manual)

- **WHEN** a transfer is confirmed on Mainnet
- **THEN** `fund_sent` is emitted once with `cluster: "mainnet"`, not `"mainnet-beta"`

#### Scenario: A declined signature is counted (manual)

- **WHEN** the user rejects the transfer in the wallet
- **THEN** `fund_failed` is emitted once with `stage: "send"` and `reason: "rejected"`
