# Spec Delta

## MODIFIED Requirements

### Requirement: Funding is measured

The `features/fund-wallet` slice SHALL emit, with prefix `fund`:
`fund_dialog_opened` `{ from: "account-menu" | "wallet-chip" | "deploy-card" | "tutorial-card" | "faucet-toast" }` (the control that opened it) when the dialog opens;
`fund_wallet_connected` `{ wallet: string, as: "payer" | "current" }` (the wallet's name; `payer` when it
connects in the dialog, `current` when the wallet chip makes it the current wallet);
`fund_wallet_connect_started` `{ wallet: string }` when the wallet chip asks a wallet to connect;
`fund_wallet_connect_failed` `{ wallet: string, reason: "rejected" | "network" | "unconfirmed" | "unknown" }`
when that connect does not happen (`rejected` is the user's no); `fund_wallet_disconnected` `{ wallet: string }`
when the chip disconnects the current wallet; `fund_sent` `{ cluster: "mainnet-beta" | "devnet" | "testnet" | "localnet" | "playnet" }` (the Playground's cluster) when a
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


## ADDED Requirements

### Requirement: The wallet chip connects an extension wallet

The wallet chip's popover SHALL offer "Connect a wallet" (also the list's heading) while the Playground wallet is current. Pressing
it SHALL list the installed Wallet Standard wallets, each with its icon and name; with none installed it
SHALL say "No wallet extension found in this browser. Install Phantom, Backpack or Solflare, then reload.
Or keep using the Playground wallet.", the same line as the Fund dialog. (The chip is hidden on a phone, so the phone line of
the designers' wallet spec does not apply here.) Choosing
one SHALL show "Waiting for {wallet}…" until the extension answers. An approval SHALL make the extension
the current wallet, as `connect {wallet}` does in the terminal; a decline SHALL say "{wallet} didn't
connect. The Playground wallet is in use." with "Try again"; any other failure SHALL say "{wallet} didn't
connect: {reason}. The Playground wallet is in use." and be reported to the logs. The waiting state SHALL NOT trap: closing the
popover leaves it, reopening while the request is pending shows "Waiting for {wallet}…" again, and a late
approval or decline lands as above.

While an extension is current, the popover's first block SHALL name the extension with its icon in place
of "Playground wallet", show its balance and address, and offer "Disconnect {wallet}", which SHALL make
the Playground wallet current again, and SHALL be disabled with "Disconnect after the deploy finishes" while
a deploy runs. "Send from your wallet" SHALL NOT show then, since the current wallet
is the user's own.

#### Scenario: Connect Phantom from the chip (manual)

- **WHEN** the Playground wallet is current and the user picks Phantom under "Connect a wallet" and
  approves in the extension
- **THEN** the chip shows Phantom's address and balance, and the popover names Phantom and offers
  "Disconnect Phantom"

#### Scenario: No extension installed (manual)

- **WHEN** no Wallet Standard wallet is installed and the user presses "Connect a wallet"
- **THEN** the popover says "No wallet extension found in this browser. Install Phantom, Backpack or
  Solflare, then reload. Or keep using the Playground wallet."

#### Scenario: Disconnect (manual)

- **WHEN** Phantom is current and the user presses "Disconnect Phantom"
- **THEN** the Playground wallet is current again and the chip shows its address
