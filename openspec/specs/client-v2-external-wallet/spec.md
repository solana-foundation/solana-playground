# client-v2-external-wallet Specification

## Purpose
How client-v2 finds and connects the user's own Wallet Standard wallets
(Phantom, Solflare, Backpack and the like), and the limits on what a connected
external wallet changes in the Playground.

## Requirements

### Requirement: Wallets are found through ConnectorKit
The client SHALL discover installed Wallet Standard wallets through
ConnectorKit (`@solana/connector`) and SHALL NOT depend on
`@solana/wallet-adapter-react` or `@solana/wallet-adapter-base`. It SHALL offer
only wallets that support a Solana chain, report account changes and sign
transactions, as wallet-adapter did. A wallet that registers after the page has
loaded SHALL be offered without a reload.

#### Scenario: An installed wallet is offered
- **WHEN** a Wallet Standard wallet that supports Solana is installed and the app loads
- **THEN** the wallet's name and icon are offered wherever the app lists wallets to connect (the Fund dialog, the wallet window's menu, the `connect` command's completions)

#### Scenario: A wallet that registers late
- **WHEN** a wallet registers itself after the app has loaded
- **THEN** it is offered in those places without a reload

#### Scenario: A wallet without Solana support
- **WHEN** a registered Wallet Standard wallet supports no Solana chain
- **THEN** it is not offered

#### Scenario: A wallet that cannot sign transactions (manual)
- **WHEN** a registered wallet offers only `solana:signAndSendTransaction`, or no `standard:events`
- **THEN** it is not offered, so no signing path receives a wallet that cannot sign

### Requirement: The existing wallet commands keep their behaviour
Connecting, disconnecting and switching to an external wallet through the
`connect <wallet>` terminal command or the wallet window SHALL behave as before
the move to ConnectorKit, and scripts and tests SHALL find connected external
wallets in `pg.wallets` under the same camelCase names.

#### Scenario: Connect from the terminal
- **WHEN** the user runs `connect phantom` with Phantom installed
- **THEN** Phantom asks for approval, and on approval the terminal prints `Connected to Phantom.` and Phantom becomes the current wallet, as before

#### Scenario: A connected wallet in a script (manual)
- **WHEN** Phantom is connected and a client script reads `pg.wallets.phantom.publicKey`
- **THEN** it gets Phantom's selected account

#### Scenario: The user changes account in the extension (manual)
- **WHEN** the user switches the selected account inside a connected wallet
- **THEN** the app's current wallet address follows it without a reload

### Requirement: A connected external wallet does not change deploy signing
Connecting an external wallet SHALL NOT change which wallet signs a deploy or
an upgrade, or which key becomes the program's upgrade authority, compared with
the behaviour before this change.

#### Scenario: Deploy with the Playground wallet current (manual)
- **WHEN** an external wallet is connected only for funding and the Playground wallet is the current wallet
- **THEN** a deploy is paid and signed by the Playground wallet alone, and the Playground wallet is the upgrade authority

### Requirement: Several external wallets can be connected at once
Connecting one external wallet SHALL NOT disconnect another, so a wallet
connected to pay for funding leaves an extension that is the current wallet
connected and current.

#### Scenario: A payer beside the current extension
- **WHEN** Phantom is the current wallet and the user connects Solflare in the Fund dialog
- **THEN** both are connected, Phantom is still the current wallet, and `pg.wallets` holds both

### Requirement: A reload keeps the current external wallet
After a reload the client SHALL reconnect the external wallet that was the
current wallet, without an approval prompt when the wallet itself still
trusts the site, and SHALL NOT reconnect one the user disconnected.

#### Scenario: Reload after connecting
- **WHEN** Phantom is the current wallet and the user reloads the page
- **THEN** Phantom is the current wallet again without an approval prompt

#### Scenario: Reload after disconnecting
- **WHEN** the user disconnected Phantom and reloads the page
- **THEN** Phantom is not connected
