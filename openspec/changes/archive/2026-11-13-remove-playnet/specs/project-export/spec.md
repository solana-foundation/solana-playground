## MODIFIED Requirements

### Requirement: The exported code chooses its cluster and wallet locally

The shim SHALL connect to the URL in the environment variable
`SOLANA_RPC_URL`, and without it to the public endpoint of the cluster the
Playground was on when the project was exported
(`https://api.devnet.solana.com`, `https://api.testnet.solana.com` or
`https://api.mainnet-beta.solana.com`; a local validator keeps its URL, and
an unknown cluster falls back to devnet). The zip and the dialog
SHALL never hold the URL the Playground used for a public cluster: a
platform or custom RPC URL can carry a key. `pg.wallet` SHALL be the
keypair in the file named by `SOLANA_KEYPAIR`, and without it
`~/.config/solana/id.json`, read the first time code uses `pg.wallet`; when
the file is missing it SHALL fail with a message naming the path and
`solana-keygen new`. The zip SHALL never hold the Playground wallet's
secret key. The README SHALL name both variables and their defaults.

#### Scenario: The exported cluster (manual)

- **WHEN** the Playground is connected to devnet and a project with no
  program is exported with the TypeScript profile
- **THEN** `playground.ts` falls back to `https://api.devnet.solana.com`
  and reads `SOLANA_RPC_URL` first

#### Scenario: A private RPC URL stays out of the zip (manual)

- **WHEN** the Playground is on devnet through a platform or custom RPC URL
  that carries an API key, and a project with no program is exported
- **THEN** no exported file and no dialog text holds that URL, and
  `playground.ts` falls back to `https://api.devnet.solana.com`

#### Scenario: A client that never uses the wallet (manual)

- **WHEN** an exported client uses only `pg.connection` and no keypair file
  exists
- **THEN** it runs without reading a keypair
