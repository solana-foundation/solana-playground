# Spec Delta

## Purpose

How the terminal's `anchor idl` command publishes, reads, and manages a program's IDL as Anchor 1.1.2's CLI does, which
of that CLI's IDL commands the Playground does not support, where the Playground differs from that CLI, and which
events the command sends.

## ADDED Requirements

### Requirement: anchor idl offers the subcommands of Anchor 1.1.2

`anchor idl` SHALL offer the subcommands of Anchor 1.1.2's CLI under their names, with their arguments and options:
`init`, `upgrade`, `fetch`, `close`, `create-buffer`, `set-buffer-authority`, `write-buffer`, `convert`, `type`,
`build`, and `fetch-historical`. A name that CLI does not have is no subcommand: the terminal SHALL print the usage
of `anchor idl` and send nothing. `authority`, `set-authority`, `erase-authority`, and `set-buffer` are such names.
`anchor --version` and `anchor -V` SHALL print the version line of that CLI, with the Anchor version the build server
compiles against, and SHALL need no connection.

#### Scenario: Help lists the subcommands

- **WHEN** the user runs `anchor idl --help`
- **THEN** the terminal lists the eleven subcommands and none of `authority`, `set-authority`, `erase-authority`,
  and `set-buffer`

#### Scenario: A name Anchor 1.1.2 removed

- **WHEN** no wallet is connected and the user runs `anchor idl set-authority`
- **THEN** the terminal prints the usage of `anchor idl`, asks no wallet question, and sends no transaction

#### Scenario: anchor --version

- **WHEN** the user runs `anchor --version` or `anchor -V`, online or offline
- **THEN** the terminal prints `anchor-cli <VERSION>`, where `<VERSION>` is the Anchor version the build server
  compiles against

### Requirement: anchor idl takes its cluster, wallet, and files from the Playground

Every subcommand SHALL act on the cluster selected in Settings and SHALL sign with the connected wallet. Anchor's
`--provider.cluster`, `--provider.wallet`, and `--commitment` SHALL NOT be accepted. A path argument or option SHALL
name a file of the project. A subcommand that sends a transaction SHALL accept Anchor's `--priority-fee`, a price in
micro-lamports per compute unit, and SHALL ask the wallet for one approval that covers every transaction.

#### Scenario: A cluster option is refused

- **WHEN** the user runs `anchor idl fetch <PROGRAM_ID> --provider.cluster devnet`
- **THEN** the terminal prints its unknown-option error and sends no transaction

#### Scenario: One approval from an external wallet (manual)

- **WHEN** an external wallet is connected and an upload needs more than one transaction
- **THEN** the wallet asks for one approval that covers every transaction

#### Scenario: An output option writes a project file

- **WHEN** the user runs `anchor idl fetch <PROGRAM_ID> --out idl/fetched.json` for a program with a published IDL
- **THEN** the project holds `idl/fetched.json` with that IDL

### Requirement: anchor idl init and upgrade publish an IDL

`anchor idl init` and `anchor idl upgrade` SHALL write an IDL to the canonical Program Metadata account (seed `idl`)
of a program on the selected cluster, creating the account or replacing the IDL it holds. The IDL SHALL be the file
`--filepath` names, or without that option the latest IDL uploaded to the project. On success the command SHALL
print Anchor's line, `IDL initialized.` or `IDL upgraded.`, and the account's address.

#### Scenario: A first upload

- **WHEN** the latest IDL uploaded to the project is in the Anchor 0.30+ format, the connected wallet is the upgrade
  authority of the program deployed on Devnet, and the user runs `anchor idl init`
- **THEN** the terminal prints `IDL initialized.` and the Program Metadata account's address
- **AND** reading that account on Devnet returns the JSON the project holds

#### Scenario: A second upload replaces the first

- **WHEN** the program already has an IDL in its canonical Program Metadata account and the user runs
  `anchor idl upgrade`
- **THEN** the terminal prints `IDL upgraded.`, and reading the account returns the new JSON

#### Scenario: An IDL file

- **WHEN** the project holds `idl/counter.json` and the user runs `anchor idl init --filepath idl/counter.json`
- **THEN** the IDL of that file is written, not the latest IDL uploaded to the project

### Requirement: An unfinished upload is finished or closed, never read as an IDL

An upload that fails after its first transaction can leave a Program Metadata buffer, not a metadata account, at the
program's canonical address (seed `idl`). When an upload fails that way, the terminal SHALL print, after the failure,
one line saying that an unfinished upload holds the buffer's rent in SOL at that address and that running the same
command again finishes it. `anchor idl init` and `anchor idl upgrade`, run again by the buffer's authority, SHALL
finish the upload: the address then holds a metadata account with the new IDL and no buffer, under the wallet's one
approval; `anchor idl write-buffer` SHALL do the same. `anchor idl fetch` SHALL NOT print a buffer's content as an IDL: it SHALL print the line that the program
has no published IDL, then one line saying an upload to it is unfinished. `anchor idl close` SHALL close such a
buffer and return its rent to the wallet, under the authority rule it applies to a metadata account.
`anchor idl write-buffer` SHALL refuse, before sending, a `--buffer` that is the program's metadata account.

A failed send that leaves a buffer at an address of its own (an `upgrade` or `init` over an existing IDL too large
for one transaction, or `create-buffer`) SHALL be followed by one line naming the SOL it holds and its address,
saying that no terminal command closes it. When a send's transactions expire before every one is confirmed, the
failure SHALL be printed as one line saying so and telling the user to run the same command again, followed by the
line for any buffer the send left. A transaction that is confirmed with an error is that error, never an expiry.

#### Scenario: A failed upload names the rent it leaves

- **WHEN** `anchor idl init` sends its first transaction and a later one fails
- **THEN** the terminal prints the failure, then a line naming the SOL held at the canonical address and saying that
  running `anchor idl init` again finishes the upload
- **AND** the memory provider records `idl_upload_failed` with `reason: "unfinished"`

#### Scenario: Running init again finishes the upload

- **WHEN** a buffer of an unfinished upload sits at the canonical address and its authority runs `anchor idl init`
  again
- **THEN** the terminal prints `IDL initialized.`, the address holds a metadata account with the IDL, and
  `anchor idl fetch <PROGRAM_ID>` prints it

#### Scenario: Fetch does not print a buffer

- **WHEN** a buffer of an unfinished upload sits at the canonical address and the user runs
  `anchor idl fetch <PROGRAM_ID>`
- **THEN** the terminal prints the line that the program has no published IDL, then a line saying an upload to it is
  unfinished, and no buffer bytes

#### Scenario: Close recovers the rent of an unfinished upload

- **WHEN** a buffer of an unfinished upload sits at the canonical address and the upgrade authority runs
  `anchor idl close <PROGRAM_ID>`
- **THEN** the buffer is closed, its rent less the fee returns to the wallet, and the terminal prints
  `Metadata account closed successfully.`

### Requirement: anchor idl init and upgrade choose the program as Anchor does

The program SHALL be the `PROGRAM_ID` argument. Without one it SHALL be the `address` of the IDL file `--filepath`
names, as in Anchor, or the project's program id when no file is given. Without an argument and without a file,
when the project has no program id, the command SHALL end with one terminal line saying so and SHALL send no
transaction and no event.

#### Scenario: A program id argument

- **WHEN** the user runs `anchor idl init <PROGRAM_ID>` with the id of a program whose upgrade authority is the
  connected wallet
- **THEN** the IDL is written for that program, not for the project's program id

#### Scenario: The address of an IDL file

- **WHEN** the user runs `anchor idl init --filepath idl/other.json` without a program id, and the file's `address`
  is a program whose upgrade authority is the connected wallet
- **THEN** the IDL is written for the program at that `address`, not for the project's program id

#### Scenario: No program id to write for

- **WHEN** the project has no program id (it was never built, and none was set) and the user runs `anchor idl init`
  without an argument and without `--filepath`
- **THEN** the terminal prints one line saying the project has no program id and to build the program or pass a
  program id, and no transaction is sent
- **AND** the memory provider records no `idl_upload_started`

### Requirement: anchor idl init writes a non-canonical account on request

`anchor idl init --non-canonical` SHALL write the IDL to the Program Metadata account derived from the program, the
seed `idl`, and the connected wallet, for a wallet that is not the program's upgrade authority. For the upgrade
authority it SHALL end with one terminal line saying to run the command without `--non-canonical`, and SHALL send
nothing: the client Anchor runs sends a transaction the program rejects in that case.

#### Scenario: A wallet that is not the authority publishes its own IDL

- **WHEN** the connected wallet is not the program's upgrade authority and the user runs
  `anchor idl init --non-canonical <PROGRAM_ID>`
- **THEN** the terminal prints `IDL initialized.`
- **AND** `anchor idl fetch <PROGRAM_ID> --non-canonical` with the same wallet prints that IDL

#### Scenario: The upgrade authority asks for a non-canonical account

- **WHEN** the connected wallet is the program's upgrade authority and the user runs
  `anchor idl init --non-canonical <PROGRAM_ID>`
- **THEN** the terminal prints one line saying to run the command without `--non-canonical`, and no transaction is
  sent

### Requirement: anchor idl init and upgrade skip a local validator

On an endpoint whose URL contains `localhost` or `127.0.0.1`, `anchor idl init` and `anchor idl upgrade` SHALL print
Anchor's line, `Skipping IDL initialization on localnet` or `Skipping IDL upgrade on localnet`, and SHALL send no
transaction and no event.

#### Scenario: Init on Localnet

- **WHEN** the selected cluster is Localnet and the user runs `anchor idl init`
- **THEN** the terminal prints `Skipping IDL initialization on localnet`, and no transaction is sent

### Requirement: An upload refuses without a usable IDL or the upgrade authority

Before any transaction, `anchor idl init` and `anchor idl upgrade` SHALL end with one terminal line and send nothing
when there is no IDL to upload, the IDL is not in the Anchor 0.30+ format, the program is not deployed on the selected
cluster, the program has no upgrade authority, or the connected wallet is not that authority. The line SHALL say
which, and for a wrong wallet SHALL name the authority. With `--non-canonical` the two authority conditions SHALL
NOT apply.

#### Scenario: No IDL in the project

- **WHEN** no IDL was uploaded to the project and the user runs `anchor idl init` without `--filepath`
- **THEN** the terminal prints one line saying the project has no IDL, and no transaction is sent

#### Scenario: A missing IDL file

- **WHEN** the project holds no `idl/none.json` and the user runs `anchor idl init --filepath idl/none.json`
- **THEN** the terminal prints one line naming that path, and no transaction is sent

#### Scenario: An Anchor 0.29 IDL

- **WHEN** the latest IDL uploaded to the project is in the Anchor 0.29 format and the user runs `anchor idl init`
- **THEN** the terminal prints one line saying the IDL is not in the Anchor 0.30+ format, and no transaction is sent

#### Scenario: A wallet that is not the authority

- **WHEN** the connected wallet is not the program's upgrade authority and the user runs `anchor idl upgrade`
- **THEN** the terminal prints one line naming the upgrade authority, and no transaction is sent

#### Scenario: A program that is not deployed

- **WHEN** the program id has no program on the selected cluster and the user runs `anchor idl init`
- **THEN** the terminal prints one line saying the program is not deployed there, and no transaction is sent

### Requirement: anchor idl fetch prints a published IDL

`anchor idl fetch <PROGRAM_ID>` SHALL read the program's canonical Program Metadata account (seed `idl`) on the
selected cluster and print its content, or with `--out` write the content to that file and print the line of the
client Anchor runs, `Metadata content saved to` and the path. With `--non-canonical` it SHALL read the account of
the connected wallet instead. It SHALL send no transaction, SHALL need a wallet only with
`--non-canonical`, and SHALL end with one terminal line when the program has no such account.

#### Scenario: Fetch after an upload

- **WHEN** `anchor idl init` succeeded for a program on Devnet, no wallet is connected, and the user runs
  `anchor idl fetch <PROGRAM_ID>`
- **THEN** the terminal prints the JSON that was uploaded and asks no wallet question

#### Scenario: A program without a published IDL

- **WHEN** the program has no canonical Program Metadata account for the seed `idl` and the user runs
  `anchor idl fetch <PROGRAM_ID>`
- **THEN** the terminal prints one line saying the program has no published IDL

### Requirement: anchor idl close closes a metadata account

`anchor idl close <PROGRAM_ID>` SHALL close the program's canonical Program Metadata account for the seed `idl`, or
for the seed `--seed` names, send the account's rent to the connected wallet, and print Anchor's line,
`Metadata account closed successfully.` Before any transaction it SHALL end with one terminal line and send nothing
when the connected wallet is not the program's upgrade authority, as the client Anchor runs requires, or when the
account does not exist.

#### Scenario: Close returns the rent

- **WHEN** the connected wallet is the upgrade authority of a program with a published IDL on Devnet and the user
  runs `anchor idl close <PROGRAM_ID>`
- **THEN** the terminal prints `Metadata account closed successfully.`, and the wallet's balance grows by the
  account's rent less the fee
- **AND** `anchor idl fetch <PROGRAM_ID>` says the program has no published IDL

#### Scenario: Close by another wallet

- **WHEN** the connected wallet is not the program's upgrade authority and the user runs
  `anchor idl close <PROGRAM_ID>`
- **THEN** the terminal prints one line naming the upgrade authority, and no transaction is sent

### Requirement: anchor idl create-buffer stores an IDL in a buffer

`anchor idl create-buffer` SHALL create a Program Metadata buffer account that holds the IDL of the file
`--filepath` names, or without that option the latest IDL uploaded to the project, with the connected wallet as the
buffer's authority. It SHALL print Anchor's line, `Buffer created successfully.`, and the buffer's address.

#### Scenario: A buffer from the project's IDL

- **WHEN** an IDL was uploaded to the project and the user runs `anchor idl create-buffer` on Devnet
- **THEN** the terminal prints `Buffer created successfully.` and an address
- **AND** the account at that address is a Program Metadata buffer whose authority is the connected wallet

### Requirement: anchor idl set-buffer-authority hands a buffer over

`anchor idl set-buffer-authority <BUFFER> --new-authority <NEW_AUTHORITY>` SHALL set the authority of that buffer
and print Anchor's line, `Buffer authority set successfully.` Before any transaction it SHALL end with one terminal
line and send nothing when the buffer does not exist or its authority is not the connected wallet.

#### Scenario: A buffer gets a new authority

- **WHEN** the connected wallet is the authority of a buffer and the user runs
  `anchor idl set-buffer-authority <BUFFER> --new-authority <NEW_AUTHORITY>`
- **THEN** the terminal prints `Buffer authority set successfully.`, and the buffer's authority is the new key

### Requirement: anchor idl write-buffer writes a metadata account from a buffer

`anchor idl write-buffer <PROGRAM_ID> --buffer <BUFFER>` SHALL write the program's canonical Program Metadata
account, for the seed `idl` or the seed `--seed` names, from the data of that buffer, and print Anchor's line,
`Metadata written successfully using buffer.` With `--close-buffer` it SHALL close the buffer afterwards. Before any
transaction it SHALL end with one terminal line and send nothing when the connected wallet is not the program's
upgrade authority.

#### Scenario: Publish through a buffer

- **WHEN** the upgrade authority runs `anchor idl create-buffer`, then
  `anchor idl write-buffer <PROGRAM_ID> --buffer <BUFFER> --close-buffer` with the address that was printed
- **THEN** the terminal prints `Metadata written successfully using buffer.`
- **AND** `anchor idl fetch <PROGRAM_ID>` prints the IDL the buffer held, and the buffer account no longer exists

### Requirement: anchor idl build, fetch-historical, convert, and type are not supported yet

`anchor idl build`, `anchor idl fetch-historical`, `anchor idl convert`, and `anchor idl type` SHALL end on every
cluster with one terminal line saying the Playground terminal does not support the subcommand yet. They SHALL send no
transaction and SHALL NOT ask for a wallet.

#### Scenario: anchor idl build

- **WHEN** no wallet is connected and the user runs `anchor idl build`
- **THEN** the terminal prints the not-supported line, asks no wallet question, and sends no transaction

#### Scenario: anchor idl convert and type

- **WHEN** the user runs `anchor idl convert idl/counter.json`, then `anchor idl type idl/counter.json`
- **THEN** each prints the not-supported line, asks no wallet question, and sends no transaction

### Requirement: anchor legacy-idl is not supported yet

`anchor legacy-idl`, Anchor 1.1.2's deprecated group for the IDL account of programs built before Anchor 0.30, SHALL
end with one terminal line saying the Playground terminal does not support it, whatever subcommand follows it. It
SHALL send no transaction and SHALL NOT ask for a wallet.

#### Scenario: anchor legacy-idl

- **WHEN** no wallet is connected and the user runs `anchor legacy-idl fetch <PROGRAM_ID>`
- **THEN** the terminal prints the not-supported line, asks no wallet question, and sends no transaction

### Requirement: An IDL upload sends its events

The `program-idl` slice SHALL send, with prefix `idl`: `idl_upload_started { target, cluster }` when an upload starts,
before its checks; `idl_uploaded { target, cluster }` when every transaction is confirmed; and
`idl_upload_failed { target, cluster, reason }` when the upload ends any other way. `target` is `metadata`. `cluster`
is the endpoint's cluster, or `custom` for a custom RPC. A command refused on mainnet SHALL send `idl_upload_started`
and then `idl_upload_failed`, so that attempts on mainnet can be counted. No event SHALL carry an address, a
signature, or the IDL.

#### Scenario: A successful upload is tracked

- **WHEN** `anchor idl init` succeeds on Devnet
- **THEN** the memory provider records `idl_upload_started` and then `idl_uploaded`, both with
  `{ target: "metadata", cluster: "devnet" }`

#### Scenario: An upload through a custom RPC is tracked

- **WHEN** the endpoint is a custom RPC that serves Devnet, a URL that is none of the Playground's own endpoints
  (`CLUSTERS`), and `anchor idl init` succeeds
- **THEN** the memory provider records `idl_upload_started` and then `idl_uploaded`, both with
  `{ target: "metadata", cluster: "custom" }`, not `devnet`

#### Scenario: A mainnet refusal is tracked

- **WHEN** the endpoint is mainnet and the user runs `anchor idl init`
- **THEN** the memory provider records `idl_upload_started` with `{ target: "metadata", cluster: "mainnet" }`
  and then `idl_upload_failed` with `{ target: "metadata", cluster: "mainnet", reason: "mainnet" }`
- **AND** no transaction is sent

### Requirement: A failed upload names its reason

`idl_upload_failed` SHALL carry one `reason`: `not_found` when there is no IDL to upload, `invalid` when the file is
not JSON or the IDL is not in the Anchor 0.30+ format, `not_deployed` when the program is not on the cluster, `authority` when the program
has no upgrade authority or the wallet is not it, `rejected` when the wallet declines the approval, `mainnet` when
the command is refused because the endpoint is mainnet, `unfinished` when a failed send leaves a buffer the
terminal names, `send_failed` for any other failure after the first transaction was submitted to the cluster, and `rpc` for any other
failure before it, an endpoint that does not say which network it serves included.

#### Scenario: A wrong wallet is tracked

- **WHEN** the connected wallet is not the upgrade authority and the user runs `anchor idl init` on Devnet
- **THEN** the memory provider records `idl_upload_failed` with
  `{ target: "metadata", cluster: "devnet", reason: "authority" }`

#### Scenario: A declined approval is tracked (manual)

- **WHEN** the user declines the wallet's approval of an upload
- **THEN** the memory provider records `idl_upload_failed` with `reason: "rejected"`, and no transaction is sent

### Requirement: The other on-chain subcommands send their events

For `fetch`, `close`, `create-buffer`, `set-buffer-authority`, and `write-buffer`, the `program-idl` slice SHALL
send, with prefix `idl`: `idl_command_started { command, cluster }` when the subcommand starts, before its checks;
`idl_command_succeeded { command, cluster }` when it ends as its requirement says; and
`idl_command_failed { command, cluster, reason }` when it ends any other way. `command` is the subcommand's name, and
`cluster` is as in the upload events. A command refused on mainnet SHALL send `idl_command_started` and then
`idl_command_failed`. No event SHALL carry an address, a signature, a path, or an IDL.

#### Scenario: A fetch is tracked

- **WHEN** `anchor idl fetch <PROGRAM_ID>` prints an IDL on Devnet
- **THEN** the memory provider records `idl_command_started` and then `idl_command_succeeded`, both with
  `{ command: "fetch", cluster: "devnet" }`

### Requirement: A failed subcommand names its reason

`idl_command_failed` SHALL carry one `reason`: `not_found` when the IDL, file, or account the subcommand needs does
not exist, `invalid` when the file is not JSON, the IDL is not in the Anchor 0.30+ format, or `write-buffer`'s
`--buffer` names the program's metadata account, `not_deployed` when the program is not on the
cluster, `authority` when the connected wallet may not act on the account, `rejected` when the wallet declines the
approval, `mainnet` when the command is refused because the endpoint is mainnet, `unfinished` when a failed send
leaves a buffer the terminal names, `send_failed` for any other failure after the first transaction was submitted to the cluster, `rpc`
for any other failure before it, and `unsupported` for `build`, `fetch-historical`, `convert`, `type`, and
`legacy-idl`, which send this event alone, with their name as `command`.

#### Scenario: A close refused on mainnet is tracked

- **WHEN** the endpoint is mainnet and the user runs `anchor idl close <PROGRAM_ID>`
- **THEN** the memory provider records `idl_command_started` and then `idl_command_failed` with
  `{ command: "close", cluster: "mainnet", reason: "mainnet" }`, and no transaction is sent

#### Scenario: A fetch without a published IDL is tracked

- **WHEN** the program has no published IDL and the user runs `anchor idl fetch <PROGRAM_ID>` on Devnet
- **THEN** the memory provider records `idl_command_failed` with
  `{ command: "fetch", cluster: "devnet", reason: "not_found" }`

#### Scenario: An unsupported subcommand is tracked

- **WHEN** the user runs `anchor idl fetch-historical <PROGRAM_ID>` on Devnet
- **THEN** the memory provider records `idl_command_failed` with
  `{ command: "fetch-historical", cluster: "devnet", reason: "unsupported" }` and no `idl_command_started`
