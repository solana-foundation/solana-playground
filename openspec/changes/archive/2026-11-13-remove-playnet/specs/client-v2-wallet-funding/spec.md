## MODIFIED Requirements

### Requirement: Funding is measured

The `features/fund-wallet` slice SHALL emit, with prefix `fund`:
`fund_dialog_opened` `{ via: "account-menu" | "wallet-chip" | "deploy-card" | "tutorial-card" | "faucet-toast" }` (the control that opened it) when the dialog opens;
`fund_wallet_connected` `{ wallet: string, as: "payer" | "current" }` (the wallet's name; `payer` when it
connects in the dialog, `current` when the wallet chip makes it the current wallet);
`fund_wallet_connect_started` `{ wallet: string }` when the wallet chip asks a wallet to connect;
`fund_wallet_connect_failed` `{ wallet: string, reason: "rejected" | "network" | "unconfirmed" | "unknown" }`
when that connect does not happen (`rejected` is the user's no); `fund_wallet_disconnected` `{ wallet: string }`
when the chip disconnects the current wallet; `fund_sent` `{ cluster: "mainnet" | "devnet" | "testnet" | "localnet" }` (the Playground's cluster) when a
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
