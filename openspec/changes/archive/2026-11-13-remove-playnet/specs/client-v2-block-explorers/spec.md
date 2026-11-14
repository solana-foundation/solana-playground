## MODIFIED Requirements

### Requirement: Orb links open the network they name

An Orb address link SHALL be `https://orbmarkets.io/address/<key>` and a
transaction link `https://orbmarkets.io/tx/<signature>`, with no parameter on
mainnet, `?cluster=devnet` on devnet and `?cluster=testnet` on testnet. A
program's IDL link SHALL be `https://orbmarkets.io/address/<id>/anchor-idl`,
with the same parameter. Orb reads only those three networks, so it SHALL
report that it cannot open a local validator or a custom RPC URL; the
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
