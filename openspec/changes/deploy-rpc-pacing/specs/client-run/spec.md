# Spec Delta

## Purpose

How a client project's Run starts from the stage row, what its callout says, and how it asks for the SOL its script
needs.

## ADDED Requirements

### Requirement: The faucet link names the wallet

The "Get devnet SOL" link of the callout's "Not enough SOL on devnet" state (`client-run-funding`) SHALL open
`https://faucet.solana.com` in a new tab with the Playground wallet's address and the devnet cluster filled in:
`https://faucet.solana.com/?walletAddress=<address>&cluster=devnet`.

#### Scenario: The funding card's faucet link (manual)

- **WHEN** a user with an empty Playground wallet presses Run on a docs link's project that needs SOL
- **THEN** "Get devnet SOL" links to `https://faucet.solana.com/?walletAddress=<address>&cluster=devnet` with the
  wallet's address
