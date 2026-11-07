# cli-deploy Specification

## Purpose

Lets a user take the program Playground built out of the browser and deploy
it from their own machine with the Solana CLI or Anchor.

## Requirements

### Requirement: The Build stage offers the program binary

After a successful build, the Build stage SHALL show an outline button
"Download .so" beside "Download IDL". A press SHALL fetch the binary of the
project's last build from the build server and save it as `<program>.so`,
where `<program>` is the IDL's program name, else the workspace name, in
snake_case (camelCase split at its word boundaries), else `program`. The bytes SHALL NOT be kept in the client. A failed or restored
build SHALL show no such button.

#### Scenario: Binary offered after a successful build (manual)

- **WHEN** the build succeeds for a program whose IDL names it `hello_anchor`
- **THEN** the Build stage shows "Download .so" beside "Download IDL", and a
  press saves `hello_anchor.so`

#### Scenario: No binary after a failed build (manual)

- **WHEN** the build fails
- **THEN** the Build stage shows no "Download .so" button

### Requirement: A missing build asks for a rebuild

When the build server answers that the program is not built (its build
directory is gone), the download SHALL show "Build again to download the
binary." as a status line beside the button and save nothing; with no build
id in the browser it SHALL show "Build the program to download the binary."
without asking the server. Any other failure, an empty answer included,
SHALL toast "Could not download the program binary." and be logged.

#### Scenario: Build expired on the server (manual)

- **WHEN** the user presses "Download .so" and the server answers
  "Program is not built"
- **THEN** "Build again to download the binary." shows and no file is saved

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
Opened from the mainnet warning it SHALL open on Mainnet; otherwise on the
current cluster when that is mainnet-beta, devnet or testnet, else on Devnet.
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
cluster, which opens the guide on the current cluster. It SHALL sit in one row
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

### Requirement: CLI deploy events

The slice SHALL send these events, none carrying an address, key or file
content:

- `cli_binary_downloaded` `{ from: "build-stage" | "guide" }`: a binary was
  fetched and handed to the browser to save;
- `cli_binary_download_failed` `{ from: "build-stage" | "guide", reason: "no-build" | "not-built" | "server" | "save" }`: no binary was saved;
  `no-build` with no build id in the browser, `not-built` when the server no
  longer holds the build, `save` when the browser refused the file;
- `cli_idl_downloaded` `{}`: the guide's "Download IDL" handed the IDL to
  the browser to save;
- `cli_guide_opened` `{ from: "mainnet-warning" | "deploy-stage" }`;
- `cli_command_copied` `{ tool: "solana" | "anchor", cluster: "mainnet" | "devnet" | "testnet", step: "deploy" | "idl" }`: a command's copy button was pressed,
  `step` naming step 3 or step 3.1.

#### Scenario: Events of a download and a copy (manual)

- **WHEN** the user opens the guide from the Deploy stage, downloads the
  binary and copies the Solana CLI devnet command
- **THEN** `cli_guide_opened` `{from: "deploy-stage"}`,
  `cli_binary_downloaded` `{from: "guide"}` and `cli_command_copied`
  `{tool: "solana", cluster: "devnet", step: "deploy"}` are sent in that
  order
