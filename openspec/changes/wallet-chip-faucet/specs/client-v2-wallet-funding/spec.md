# Spec Delta

## ADDED Requirements

### Requirement: The console bar shows the deploying wallet

When a wallet is current, the console bar SHALL end, before its own
controls, with a chip (`data-wallet-chip`) holding the wallet's address as
four and four characters and its balance in SOL, with the `aria-label`
"Wallet {short address} on {network}, {balance}". The chip SHALL show signed
in or not, SHALL draw a balance of 0 in the warning colour, and SHALL be
hidden below the `md` breakpoint. With no wallet there is no chip.

Pressing it SHALL open a popover in two blocks. The first names "Playground
wallet", the network as a tag (the warning tag on mainnet), the balance, and
the address as six and six characters with "Copy address". The second tops
the wallet up, with one main button per state:

- idle, on a cluster with a faucet: "Get {amount} {cluster} SOL"; under it,
  when the faucet asks for a sign-in and nobody is in, "Asks you to sign in
  with GitHub first"; then "Send from your wallet", which opens the Fund
  dialog;
- asking: the same button disabled, reading "Asking the faucet…";
- refused, when the ask fails for the faucet's limit: "The faucet is at its
  limit", the web faucet in three steps (`aria-label="Get SOL from the web
  faucet"`) ending "Come back here. The balance updates by itself", the link
  "Open the web faucet" (the faucet prefilled with the address, the amount and
  the cluster, new tab), and side by side "Try again" and "Use your wallet";
- away, once that link is pressed: "Waiting for SOL from the web faucet…",
  "Open it again" and "Use your wallet", until the balance rises over what it
  was, which moves to received;
- received: "Got {amount} SOL. You're ready to deploy" and no buttons; the
  next opening starts idle.

Any other failure of the ask SHALL return to idle and report through
`reportButtonFailure("airdrop")`; a refusal for the limit SHALL NOT toast.

#### Scenario: The chip without a sign-in (manual)

- **WHEN** a signed-out user with a Playground wallet on devnet opens a project
- **THEN** the console bar shows the chip with the address and balance, and its popover offers "Get 5 devnet SOL" with "Asks you to sign in with GitHub first"

#### Scenario: The faucet refuses the chip's ask (manual)

- **WHEN** the chip's ask fails with the faucet's 429
- **THEN** the popover shows "The faucet is at its limit", the three steps and "Open the web faucet", and no toast appears

#### Scenario: Back from the web faucet (manual)

- **WHEN** the user opens the web faucet from the popover, confirms the airdrop there and comes back
- **THEN** the chip's balance rises on its own and the popover reads "Got 5 SOL. You're ready to deploy"

### Requirement: The wallet menu's airdrop says how it went

Airdrop in the wallet window's menu SHALL say its outcome in a toast as well as
in the terminal, which may not be on screen: "Airdrop received." when it lands,
and, when the faucet refuses for its limit, "The faucet is at its limit." with
a line on signing in to the web faucet and the link "Open the web faucet" (the
faucet prefilled with the address, the amount and the cluster, new tab),
shown for 15 seconds, in place of "Could not airdrop.". A sign-in the user did
not finish stays with the account row, as before.

#### Scenario: Airdrop from Home at the faucet's limit (manual)

- **WHEN** a signed-in user on Home picks Airdrop in the wallet window's menu and the faucet answers 429
- **THEN** a toast reads "The faucet is at its limit." with "Open the web faucet"

## MODIFIED Requirements

### Requirement: Funding is measured

The `features/fund-wallet` slice SHALL emit, with prefix `fund`:
`fund_dialog_opened` `{ via: "account-menu" | "wallet-chip" }` (the control that opened it) when the dialog opens;
`fund_wallet_connected` `{ wallet: string, as: "payer" | "current" }` (the wallet's name; `payer` when it
connects in the dialog, `current` when the wallet chip makes it the current wallet);
`fund_wallet_connect_started` `{ wallet: string }` when the wallet chip asks a wallet to connect;
`fund_wallet_connect_failed` `{ wallet: string, reason: "rejected" | "network" | "unconfirmed" | "unknown" }`
when that connect does not happen (`rejected` is the user's no); `fund_wallet_disconnected` `{ wallet: string }`
when the chip disconnects the current wallet; `fund_sent` `{ cluster: "mainnet" | "devnet" | "testnet" | "localnet" | "playnet" }` (the Playground's cluster) when a
transfer is confirmed; and
`fund_failed` `{ stage: "connect" | "send", reason: "rejected" | "network" | "unconfirmed" | "unknown" }` when connecting or sending fails. The wallet chip SHALL emit
`fund_airdrop_requested` `{ via: "wallet-chip" }` when its popover asks the
faucet; `fund_airdrop_received` `{ via: "faucet" | "web-faucet" }` when the
chip's own ask lands (`faucet`) or the balance rises after the web faucet was
opened from it (`web-faucet`); `fund_airdrop_refused`
`{ reason: "rate-limited" | "failed" }` when the ask comes back without SOL
for the faucet's limit or for anything else, a sign-in the user did not
finish excepted; and `fund_web_faucet_opened` `{ via: "wallet-chip" }` when
the web faucet opens from the popover. `session_account_item_picked`
SHALL carry `item: "fund-wallet"` when the menu item is picked. No event
carries an address or an amount.

#### Scenario: A confirmed transfer is counted (manual)

- **WHEN** a transfer is confirmed on devnet
- **THEN** `fund_sent` is emitted once with `cluster: "devnet"`

#### Scenario: A refused ask from the chip is counted (manual)

- **WHEN** the chip's ask fails with the faucet's 429
- **THEN** `fund_airdrop_requested` and then `fund_airdrop_refused` with `reason: "rate-limited"` are emitted once each

#### Scenario: A declined signature is counted (manual)

- **WHEN** the user rejects the transfer in the wallet
- **THEN** `fund_failed` is emitted once with `stage: "send"` and `reason: "rejected"`
