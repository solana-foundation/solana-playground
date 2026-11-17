## ADDED Requirements

### Requirement: Airdrops go through the cluster's native RPC

Every Playground airdrop (the `airdrop` command, the wallet menu's Airdrop, the automatic airdrop, a deploy's top-up
and a tutorial's funding) SHALL request SOL from the cluster's native RPC, the URL
`REACT_APP_DEVNET_READ_BUFFER_RPC_URL`, `REACT_APP_TESTNET_READ_BUFFER_RPC_URL` or
`REACT_APP_MAINNET_READ_BUFFER_RPC_URL` sets, and SHALL confirm the airdrop's signature on that same RPC. An unset or
empty value, or an endpoint on no cluster the env configures, SHALL use the selected RPC.

#### Scenario: Devnet with a platform RPC (manual)

- **WHEN** devnet is selected through a platform RPC, `REACT_APP_DEVNET_READ_BUFFER_RPC_URL` is
  `https://api.devnet.solana.com`, and the person runs `airdrop 1` or picks Airdrop in the wallet menu
- **THEN** the `requestAirdrop` request goes to `api.devnet.solana.com`, not to the platform RPC

#### Scenario: Localnet (manual)

- **WHEN** Localnet is selected and the person runs `airdrop 1`
- **THEN** the `requestAirdrop` request goes to the local validator

### Requirement: An airdrop's balance is read where the airdrop is measured

The `airdrop` command SHALL read the wallet's balance before and after the airdrop on the RPC that took the airdrop,
and SHALL report what arrived from those two reads. A tutorial's funding check, which decides whether a deploy is
funded, SHALL read the balance on the selected RPC.

#### Scenario: The terminal reports what arrived (manual)

- **WHEN** `airdrop 1` lands on devnet through the native RPC while the platform RPC lags a slot behind
- **THEN** the terminal prints the amount received, read from the native RPC
