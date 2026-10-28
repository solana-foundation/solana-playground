# Spec Delta

## Purpose

What importing a keypair file does to the wallets a user already has, and
what the user is told when the file is not a keypair or is one the wallet
already holds.

## ADDED Requirements

### Requirement: An import never costs the user a wallet

Importing a keypair file SHALL leave every wallet the user already has in
place, whether the file is imported, rejected or the file picker is closed.
A file that is not a keypair SHALL be rejected with a message that says so
and what file to pick instead, and SHALL change nothing. An import, from
Setup or the wallet's menu, SHALL say what it did: that it added the keypair as a new
wallet, or that a wallet already holding that keypair is now the current
one.

#### Scenario: Importing in Setup over a stored wallet (manual)

- **WHEN** a user with a stored wallet opens the wallet's Setup and picks
  "Import keypair", then imports a different keypair file
- **THEN** Setup says "Imported {short address} as {wallet name}.", the
  imported wallet is the current one, and the wallet stored before is still in the wallet list

#### Scenario: A file that is not a keypair (manual)

- **WHEN** a user imports a file that is not a Solana keypair, from Setup or
  from the wallet's menu
- **THEN** they read "That file is not a keypair. Pick a .json file saved
  from Playground or the Solana CLI.", and the wallets and
  the current wallet are unchanged

#### Scenario: Importing a keypair the wallet already holds (manual)

- **WHEN** a user imports, from Setup or the wallet's menu, a keypair file
  that one of their wallets already holds
- **THEN** no wallet is added, that wallet becomes the current one, and a
  message says so by its name; a new keypair instead reads "Imported {short
  address} as {wallet name}." (Spec 12)
