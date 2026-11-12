# Spec Delta

## Purpose

How the IDL of a project's program is published on chain from the Playground, when a publish is refused, and which
events a publish sends.

## ADDED Requirements

### Requirement: anchor idl init and upgrade publish the project's IDL

`anchor idl init` and `anchor idl upgrade` SHALL write the IDL the project holds to the canonical Program Metadata
account (seed `idl`) of the program on the selected cluster, creating the account or replacing the IDL it holds. The
program SHALL be the program id argument, or the project's program id without one. Without an argument, when the
project has no program id, the command SHALL end with one terminal line saying so and SHALL send no transaction and
no event. The upload SHALL ask the wallet for one approval, and the command SHALL print the account's address and
whether the IDL was created or replaced.

#### Scenario: A first upload on Devnet (manual)

- **WHEN** the project holds an Anchor 0.30+ IDL, the connected wallet is the upgrade authority of the program
  deployed on Devnet, and the user runs `anchor idl init`
- **THEN** the terminal prints the Program Metadata account's address and says the IDL was created
- **AND** reading that account on Devnet returns the JSON the project holds

#### Scenario: A second upload replaces the first (manual)

- **WHEN** the program already has an IDL in its canonical Program Metadata account and the user runs
  `anchor idl upgrade`
- **THEN** the terminal says the IDL was replaced, and reading the account returns the new JSON

#### Scenario: A program id argument (manual)

- **WHEN** the user runs `anchor idl init <PROGRAM_ID>` with the id of a program whose upgrade authority is the
  connected wallet
- **THEN** the IDL is written for that program, not for the project's program id

#### Scenario: No program id to write for (manual)

- **WHEN** the project has no program id (it was never built, and none was set) and the user runs `anchor idl init`
  without an argument
- **THEN** the terminal prints one line saying the project has no program id and to build the program or pass a
  program id, and no transaction is sent
- **AND** the memory provider records no `idl_upload_started`

#### Scenario: One approval from an external wallet (manual)

- **WHEN** an external wallet is connected and an upload needs more than one transaction
- **THEN** the wallet asks for one approval that covers every transaction

### Requirement: An upload refuses without a usable IDL or the upgrade authority

Before any transaction, `anchor idl init` and `anchor idl upgrade` SHALL end with one terminal line and send nothing
when the project holds no IDL, the IDL is not in the Anchor 0.30+ format, the program is not deployed on the selected
cluster, the program has no upgrade authority, or the connected wallet is not that authority. The line SHALL say
which, and for a wrong wallet SHALL name the authority.

#### Scenario: No IDL in the project (manual)

- **WHEN** the project holds no IDL and the user runs `anchor idl init`
- **THEN** the terminal prints one line saying the project has no IDL, and no transaction is sent

#### Scenario: An Anchor 0.29 IDL (manual)

- **WHEN** the project holds an IDL in the Anchor 0.29 format and the user runs `anchor idl init`
- **THEN** the terminal prints one line saying the IDL is not in the Anchor 0.30+ format, and no transaction is sent

#### Scenario: A wallet that is not the authority (manual)

- **WHEN** the connected wallet is not the program's upgrade authority and the user runs `anchor idl upgrade`
- **THEN** the terminal prints one line naming the upgrade authority, and no transaction is sent

#### Scenario: A program that is not deployed (manual)

- **WHEN** the program id has no program on the selected cluster and the user runs `anchor idl init`
- **THEN** the terminal prints one line saying the program is not deployed there, and no transaction is sent

### Requirement: The other anchor idl subcommands are not supported

`anchor idl authority`, `close`, `erase-authority`, `fetch`, `set-authority`, `set-buffer`, and `write-buffer` SHALL
end on every cluster with one terminal line saying the Playground terminal does not support the subcommand and to run
Anchor's CLI on the user's own machine. They SHALL send nothing and SHALL NOT ask for a wallet.

#### Scenario: anchor idl fetch (manual)

- **WHEN** no wallet is connected and the user runs `anchor idl fetch`
- **THEN** the terminal prints the not-supported line, asks no wallet question, and sends no request to the cluster

#### Scenario: Help lists what runs (manual)

- **WHEN** the user runs `anchor idl --help`
- **THEN** the terminal lists `init` and `upgrade`

### Requirement: An IDL upload sends its events

The `program-idl` slice SHALL send, with prefix `idl`: `idl_upload_started { target, cluster }` when an upload starts,
before its checks; `idl_uploaded { target, cluster }` when every transaction is confirmed; and
`idl_upload_failed { target, cluster, reason }` when the upload ends any other way. `target` is `metadata`. `cluster`
is the endpoint's cluster, or `custom` for a custom RPC. A command refused on mainnet sends none of them. No event
SHALL carry an address, a signature, or the IDL.

#### Scenario: A successful upload is tracked (manual)

- **WHEN** `anchor idl init` succeeds on Devnet
- **THEN** the memory provider records `idl_upload_started` and then `idl_uploaded`, both with
  `{ target: "metadata", cluster: "devnet" }`

#### Scenario: An upload through a custom RPC is tracked (manual)

- **WHEN** the endpoint is a custom RPC that serves Devnet, a URL that is none of the Playground's own endpoints
  (`CLUSTERS`), and `anchor idl init` succeeds
- **THEN** the memory provider records `idl_upload_started` and then `idl_uploaded`, both with
  `{ target: "metadata", cluster: "custom" }`, not `devnet`

#### Scenario: A mainnet refusal is not tracked (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs `anchor idl init`
- **THEN** the memory provider records no `idl_upload_started`

### Requirement: A failed upload names its reason

`idl_upload_failed` SHALL carry one `reason`: `not_found` when the project holds no IDL, `invalid` when the IDL is not
in the Anchor 0.30+ format, `not_deployed` when the program is not on the cluster, `authority` when the program has
no upgrade authority or the wallet is not it, `rejected` when the wallet declines the approval, and `rpc` for any
other failure.

#### Scenario: A wrong wallet is tracked (manual)

- **WHEN** the connected wallet is not the upgrade authority and the user runs `anchor idl init` on Devnet
- **THEN** the memory provider records `idl_upload_failed` with
  `{ target: "metadata", cluster: "devnet", reason: "authority" }`

#### Scenario: A declined approval is tracked (manual)

- **WHEN** the user declines the wallet's approval of an upload
- **THEN** the memory provider records `idl_upload_failed` with `reason: "rejected"`, and no transaction is sent
