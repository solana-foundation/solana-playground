## ADDED Requirements

### Requirement: The wallet chip opens the Playground accounts

While the Playground wallet is current and no extension is being connected, the wallet chip's popover SHALL
offer "Accounts" beside "Connect a wallet", the two sharing one row. Pressing it SHALL close the popover and
open the Wallet window right above the chip, its right edge aligned with the chip's, where Playground
accounts are added and switched; the window keeps that place until the user drags it. "Accounts" SHALL NOT show while an
extension is the current wallet, since its accounts live in the extension, nor while a deploy runs.

With two or more Playground accounts, the popover's header SHALL name the account that pays after the
wallet's name: "Playground wallet · Wallet 2". With one account, or with an extension current, it SHALL name
no account. The Deploy stage's payer line SHALL name the same account.

#### Scenario: Accounts opens the Wallet window (manual)

- **WHEN** the Playground wallet is current and the user presses "Accounts" in the chip popover
- **THEN** the popover closes and the Wallet window opens right above the chip with its account list

#### Scenario: No Accounts for an extension (manual)

- **WHEN** Phantom is the current wallet and the user opens the chip popover
- **THEN** it offers "Disconnect Phantom" and no "Accounts"

#### Scenario: The paying account is named (manual)

- **WHEN** the Playground wallet holds two accounts and "Wallet 2" is current
- **THEN** the chip popover's header reads "Playground wallet · Wallet 2"
