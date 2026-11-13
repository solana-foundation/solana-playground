## MODIFIED Requirements

### Requirement: The CLI deploy guide

A dialog titled "Deploy from your machine" SHALL give the command that
deploys the downloaded binary, for the tool picked in a "Tool" control
(Solana CLI, Anchor) and the cluster picked in a "Cluster" control (Mainnet,
Devnet, Testnet, in that order), with `<program>.so` and `<program>-keypair.json` filled in, each
command block with a copy button. It SHALL offer "Download .so" while the
last build succeeded, and "Download IDL" beside it, with or without a build,
which saves the IDL Playground holds as `<program>.json` and is off while
there is none. It SHALL
say that deploying with the project's program keypair keeps the program id,
naming it, and what to do without that file.
A step "3.1 Upload the IDL" SHALL give, for both tools and every cluster,
`npx @solana-program/program-metadata@latest write idl <program-id> <program>.json --rpc <cluster url>`, where the cluster url is
`https://api.mainnet-beta.solana.com`, `https://api.devnet.solana.com` or
`https://api.testnet.solana.com`;
with Anchor picked it SHALL add `anchor idl init -f <program>.json <program-id> --provider.cluster <mainnet|devnet|testnet>` below it. Each command
block has a copy button. Without a program id the commands SHALL carry
`<program-id>`; without an IDL the step SHALL say there is no IDL to upload
and show no command.
Opened from the Deploy stage on Mainnet it SHALL open on Mainnet; otherwise on the
current cluster when that is mainnet, devnet or testnet, else on Devnet.
The Solana CLI's deploy command SHALL take `--url testnet` on Testnet.

#### Scenario: Solana CLI on devnet

- **WHEN** the guide is open for `hello_anchor` with Solana CLI and Devnet
- **THEN** it shows `solana program deploy hello_anchor.so --program-id hello_anchor-keypair.json --url devnet` with a copy button

#### Scenario: Anchor on mainnet

- **WHEN** the user picks Anchor and Mainnet
- **THEN** it shows `mkdir -p target/deploy && cp hello_anchor.so hello_anchor-keypair.json target/deploy/` and `anchor deploy --provider.cluster mainnet`

#### Scenario: IDL upload on mainnet (manual)

- **WHEN** the guide is open for `hello_anchor` with program id `<id>`, an
  IDL, Solana CLI and Mainnet
- **THEN** step 3.1 shows `npx @solana-program/program-metadata@latest write idl <id> hello_anchor.json --rpc https://api.mainnet-beta.solana.com` with
  a copy button, and no `anchor idl init`

#### Scenario: IDL upload with Anchor (manual)

- **WHEN** the user picks Anchor and Devnet
- **THEN** step 3.1 shows the Program Metadata command and below it
  `anchor idl init -f hello_anchor.json <id> --provider.cluster devnet`

#### Scenario: No IDL (manual)

- **WHEN** the project has no IDL
- **THEN** "Download IDL" is off and step 3.1 shows no command

### Requirement: The Deploy stage opens the guide

The Deploy stage SHALL show an outlined button "Deploy with the CLI", on every
cluster but mainnet (where the stage's pill opens the guide), which opens
the guide on the current cluster. It SHALL sit in one row
of outlined buttons with "Upload IDL" (and "Show full log" after a failed
deploy), in the deploy pill's height and shape. On a desk the row SHALL follow
the deploy pill; on a phone, where only the pill is pinned to the foot, the row
SHALL stay in the page above the foot.

#### Scenario: Guide from the Deploy stage

- **WHEN** the user presses "Deploy with the CLI" on the Deploy stage
- **THEN** the "Deploy from your machine" dialog opens

#### Scenario: The row on a phone (manual)

- **WHEN** a 390 px wide screen shows the Deploy stage before a deploy
- **THEN** "Upload IDL" and "Deploy with the CLI" sit in the page above the
  pinned deploy pill
