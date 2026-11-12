# Spec Delta

## Purpose

Which block explorers a user can pick for transaction and account links, which
one links open by default, and how each explorer's links reach a network.

## ADDED Requirements

Its scenarios are checked by unit tests, not in the browser, so they carry the
`(manual)` mark: `src/utils/block-explorer.test.ts` (`yarn test-unit`, under
`client-v2/`).

### Requirement: The settings offer Solana Explorer, Solscan and Orb

The "Block explorer" setting SHALL offer Solana Explorer
(`https://explorer.solana.com`), Solscan (`https://solscan.io`) and Orb
(`https://orbmarkets.io`). Its default SHALL be Solana Explorer, and a stored
name no longer offered SHALL open Solana Explorer and be stored as it.

#### Scenario: A user picks Orb (manual)

- **WHEN** the user opens Settings, Network, "Block explorer"
- **THEN** Orb is listed beside Solana Explorer and Solscan, and Solana Explorer is picked until the user changes it

### Requirement: Orb links open the network they name

An Orb address link SHALL be `https://orbmarkets.io/address/<key>` and a
transaction link `https://orbmarkets.io/tx/<signature>`, with no parameter on
mainnet, `?cluster=devnet` on devnet and `?cluster=testnet` on testnet. A
program's IDL link SHALL be `https://orbmarkets.io/address/<id>/anchor-idl`,
with the same parameter. Orb reads only those three networks, so it SHALL
report that it cannot open a local validator, playnet or a custom RPC URL; the
places that ask (the fund dialog's receiver address, the Deploy stage's links)
then show no Orb link.

#### Scenario: A transaction on devnet (manual)

- **WHEN** the picked explorer is Orb and a link opens transaction `sig` on devnet
- **THEN** the link is `https://orbmarkets.io/tx/sig?cluster=devnet`

#### Scenario: An address on mainnet (manual)

- **WHEN** the picked explorer is Orb and a link opens an address on mainnet
- **THEN** the link is `https://orbmarkets.io/address/<key>` with no parameter

#### Scenario: A program's IDL on devnet (manual)

- **WHEN** the picked explorer is Orb and Settings links a program's IDL on devnet
- **THEN** the link is `https://orbmarkets.io/address/<id>/anchor-idl?cluster=devnet`

#### Scenario: A local validator (manual)

- **WHEN** the picked explorer is Orb and the Playground is on a local validator
- **THEN** Orb reports it cannot open the network, and the fund dialog shows the receiver's address without a link
