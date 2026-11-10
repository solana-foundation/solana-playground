# Spec Delta

## ADDED Requirements

### Requirement: A faucet airdrop is counted

The `airdrop` command (`commands/airdrop/airdrop.ts`) SHALL emit
`fund_airdropped` `{ via: "terminal" | "wallet" | "stage" | "deploy" | "automatic", cluster: "mainnet-beta" | "devnet" | "testnet" | "localnet" | "playnet" }`
through the `features/fund-wallet` tracker once the airdrop has arrived in the
Playground wallet, after its balance check succeeds; a failed airdrop SHALL
emit nothing. `via` SHALL be the caller that wrapped the run with
`withAirdropVia` (`commands/airdrop/via.ts`): the wallet menu's Airdrop item
(`wallet`), the Interact stage's "needs SOL" callout (`stage`), a deploy's
top-up (`deploy`) or the automatic airdrop (`automatic`); a run nobody wrapped,
the terminal's, SHALL carry `terminal`. The event carries no amount or
address. A tutorial's airdrop card requests the airdrop from the RPC itself
and is not counted.

#### Scenario: A terminal airdrop is counted (manual)

- **WHEN** `airdrop` is run in the terminal on devnet and the balance rises
- **THEN** `fund_airdropped` is emitted once with `via: "terminal"` and `cluster: "devnet"`

#### Scenario: A deploy's top-up is counted (manual)

- **WHEN** the deploy requests an airdrop for the SOL it is missing and the balance rises
- **THEN** `fund_airdropped` is emitted once with `via: "deploy"`

#### Scenario: A failed airdrop is not counted (manual)

- **WHEN** the faucet refuses the airdrop, or the balance does not change
- **THEN** no `fund_airdropped` is emitted
