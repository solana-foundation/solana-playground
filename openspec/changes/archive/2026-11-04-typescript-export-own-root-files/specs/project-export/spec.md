# Delta for project-export

## MODIFIED Requirements

### Requirement: The TypeScript profile is a runnable Node project

The TypeScript profile SHALL keep every file of the project at its path and
SHALL add, at the root, `package.json`, `tsconfig.json`, `README.md`,
`.gitignore` and `playground.ts`, leaving out any of them the project
already holds at that path, except two. A project's own `package.json`
SHALL be completed, not replaced: every field, script and package it
declares SHALL stay as it is, and the scripts, packages and `engines` the
profile would write SHALL be added where missing, and `type` only when it
has none; one that is not JSON, not an object, or holds `scripts`,
`config`, `engines` or a dependency field that is not an object SHALL be
kept as it is, and the README SHALL say so. When the
project holds `playground` at the root under any name an import of
`../playground` resolves to, the shim SHALL be written as
`playground-shim.ts`, or the first free `playground-shim-<n>.ts`, and the
scripts and the README SHALL name that file. The `package.json` the profile
writes SHALL be an ES module package
whose dependencies are the packages the code imports or uses as Playground
globals, except `assert` and `buffer`, which Node provides, plus
`@solana/web3.js`, and SHALL hold the script `client`, which
runs a client file, when `client/` holds a script, and the script `test`,
which runs every script under `tests/` with mocha, when `tests/` holds one.
Every TypeScript or JavaScript file under `client/` and `tests/` SHALL
import the Playground globals it uses (`web3`, `anchor`, `BN`, `assert`,
`borsh`, `BufferLayout`) from their packages, and `pg` and `sleep` from
the shim. After `npm install`, `npm run client` and `npm test`
SHALL run the project's client and tests with no other change.

#### Scenario: A client and its tests run locally (manual)
- **WHEN** a project with `client/client.ts`, which logs
  `pg.wallet.publicKey` and `await pg.connection.getSlot()`, and
  `tests/basic.test.ts`, which asserts with `assert`, is exported with the
  TypeScript profile, unzipped, and `npm install` is run in it
- **THEN** `npm run client` prints the keypair's public key and a slot, and
  `npm test` passes (manual)

#### Scenario: A project's own README is kept (manual)
- **WHEN** a project with no program holds `README.md` at its root
- **THEN** the exported `README.md` is the project's, unchanged

#### Scenario: A project's own package.json is completed (manual)
- **WHEN** a project with no program holds `client/client.ts` and a root
  `package.json` with its own name, a `start` script and
  `@solana/web3.js` at its own version
- **THEN** the exported `package.json` keeps the name, the `start` script
  and that version, and adds `type: module`, the `client` script and `tsx`,
  so `npm install` and `npm run client` run the client

#### Scenario: A project's own playground.ts is kept (manual)
- **WHEN** a project with no program holds a root `playground.ts` of its own
- **THEN** that file is exported unchanged, the shim is
  `playground-shim.ts`, and the client imports `pg` from
  `../playground-shim`

### Requirement: The exported code chooses its cluster and wallet locally

The shim SHALL connect to the URL in the environment variable
`SOLANA_RPC_URL`, and without it to the public endpoint of the cluster the
Playground was on when the project was exported
(`https://api.devnet.solana.com`, `https://api.testnet.solana.com` or
`https://api.mainnet-beta.solana.com`; a local validator keeps its URL, and
playnet or an unknown cluster falls back to devnet). The zip and the dialog
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
