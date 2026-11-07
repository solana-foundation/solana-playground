# Spec Delta

## ADDED Requirements

### Requirement: A network chip is stored as its key

The settings SHALL store the connection endpoint as the picked chip's key (`mainnet-beta`, `devnet`, `testnet`,
`localnet`, `surfpool`), and as a URL only for a custom RPC. A stored key SHALL read back as the URL its chip opens
on the next load, so a platform RPC URL, its API key included, is never written to `localStorage`. The Mainnet,
Devnet and Testnet chips SHALL open the URL that `REACT_APP_MAINNET_RPC_URL`, `REACT_APP_DEVNET_RPC_URL` and
`REACT_APP_TESTNET_RPC_URL` name, or the cluster's public RPC when the variable is unset or empty. A public URL picked
as a custom RPC while its chip opens a platform RPC SHALL be stored as that custom URL and stay picked after a reload.

#### Scenario: A rotated platform key reaches the profile (manual)

- **WHEN** a profile on the Devnet chip reloads after the env's `REACT_APP_DEVNET_RPC_URL` changed its API key
- **THEN** the connection uses the new URL, and `localStorage` holds `devnet` for the endpoint, never the URL

#### Scenario: The public Devnet as a custom RPC beside a platform Devnet (manual)

- **WHEN** the env sets `REACT_APP_DEVNET_RPC_URL` and a person saves and picks `https://api.devnet.solana.com` as a
  custom RPC, then reloads
- **THEN** the `api.devnet.solana.com` chip is still checked and RPC requests go to `https://api.devnet.solana.com`
