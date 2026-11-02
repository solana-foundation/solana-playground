# Spec Delta

## Purpose

Lets a user take the program Playground built out of the browser and deploy
it from their own machine with the Solana CLI or Anchor.

## ADDED Requirements

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
(Solana CLI, Anchor) and the cluster picked in a "Cluster" control (Devnet,
Mainnet), with `<program>.so` and `<program>-keypair.json` filled in, each
command block with a copy button. It SHALL offer "Download .so" while the
last build succeeded, and say that deploying with the project's program
keypair keeps the program id, naming it, and what to do without that file.
Opened from the mainnet warning it SHALL open on Mainnet; otherwise on the
current cluster when that is devnet or mainnet-beta, else on Devnet.

#### Scenario: Solana CLI on devnet

- **WHEN** the guide is open for `hello_anchor` with Solana CLI and Devnet
- **THEN** it shows `solana program deploy hello_anchor.so --program-id
  hello_anchor-keypair.json --url devnet` with a copy button

#### Scenario: Anchor on mainnet

- **WHEN** the user picks Anchor and Mainnet
- **THEN** it shows `mkdir -p target/deploy && cp hello_anchor.so
  hello_anchor-keypair.json target/deploy/` and `anchor deploy
  --provider.cluster mainnet`

### Requirement: The Deploy stage opens the guide

The Deploy stage SHALL show a ghost button "Deploy with the CLI" beside its
deploy action, on every cluster, which opens the guide on the current
cluster.

#### Scenario: Guide from the Deploy stage

- **WHEN** the user presses "Deploy with the CLI" on the Deploy stage
- **THEN** the "Deploy from your machine" dialog opens

### Requirement: CLI deploy events

The slice SHALL send these events, none carrying an address, key or file
content:
- `cli_binary_downloaded` `{ from: "build-stage" | "guide" }`: a binary was
  fetched and handed to the browser to save;
- `cli_binary_download_failed` `{ from: "build-stage" | "guide", reason:
  "no-build" | "not-built" | "server" | "save" }`: no binary was saved;
  `no-build` with no build id in the browser, `not-built` when the server no
  longer holds the build, `save` when the browser refused the file;
- `cli_guide_opened` `{ from: "mainnet-warning" | "deploy-stage" }`;
- `cli_command_copied` `{ tool: "solana" | "anchor", cluster: "devnet" |
  "mainnet" }`: a command's copy button was pressed.

#### Scenario: Events of a download and a copy (manual)

- **WHEN** the user opens the guide from the Deploy stage, downloads the
  binary and copies the Solana CLI devnet command
- **THEN** `cli_guide_opened` `{from: "deploy-stage"}`,
  `cli_binary_downloaded` `{from: "guide"}` and `cli_command_copied`
  `{tool: "solana", cluster: "devnet"}` are sent in that order
