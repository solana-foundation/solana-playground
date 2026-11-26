# client-v2-wallet Specification

## Purpose

What the wallet panel tells the person about the wallet it shows.

## Requirements

### Requirement: The wallet panel says what the Playground wallet is

While the wallet panel shows a Playground wallet, a help mark (`data-slot`
`help-tip`, `aria-label` "About the Playground wallet") SHALL sit beside the
wallet's name. Hovering or focusing it SHALL show "A wallet kept in this
browser. Playground uses it to deploy and to sign your calls without asking. Use it for
devnet, testnet and local clusters only." While the panel shows a wallet
from a browser extension, the mark SHALL not be there.

#### Scenario: The help on a Playground wallet (manual)

- **WHEN** the wallet panel is open on a Playground wallet and the person
  hovers the help mark beside its name
- **THEN** the tooltip reads "A wallet kept in this browser. Playground uses
  it to deploy and to sign your calls without asking. Use it for devnet, testnet and local
  clusters only."

#### Scenario: No help on an extension wallet (manual)

- **WHEN** the wallet panel shows a wallet connected from a browser extension
- **THEN** no help mark sits beside its name

### Requirement: A running deploy holds the Playground accounts

A deploy SHALL sign with the account it started with. From the start of a deploy's run to its end, whether
it succeeds, fails, is stopped, paused or cancelled, and whether it started in the terminal or on the Deploy
stage, the Playground wallet SHALL refuse to switch accounts, to make an extension current (also one whose
connect was asked before the deploy began and approved during it: it stays connected, not current), and to
add, create, import or remove an account. Each refusal SHALL read "A deploy is running: accounts cannot change
until it ends." and SHALL be shown as a plain message, not reported as a failure. The hold SHALL be released
at the run's end on every path. While it is held, the Wallet window SHALL disable its account items and its
Add, Remove and Import actions, and SHALL enable them again once the deploy ends. The scenarios are held by
unit tests (`wallet.test.ts`, `deploy.test.ts`, `deploy-run.test.ts`, `Settings.test.tsx`, `Wallet.test.tsx`,
`ModalFrame.test.tsx`, `standard.test.ts`).

#### Scenario: Switching during a deploy (manual)

- **WHEN** a deploy runs and the user opens the Wallet window
- **THEN** its account items and Add, Remove and Import are disabled, and the chip offers no "Accounts"

#### Scenario: The hold ends with the deploy (manual)

- **WHEN** the deploy ends, or the user stops it
- **THEN** the Wallet window's account items are enabled and switching works
