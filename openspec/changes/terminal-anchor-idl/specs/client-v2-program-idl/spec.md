# Spec Delta

## Purpose

How the terminal's `anchor idl` command publishes, reads, and manages a program's IDL as Anchor 1.1.2's CLI does, how
`anchor legacy-idl` reads and closes the Anchor IDL account of an older program, where the Playground differs from that
CLI, and which events the command sends.

## ADDED Requirements

### Requirement: anchor idl offers the subcommands of Anchor 1.1.2

`anchor idl` SHALL offer the subcommands of Anchor 1.1.2's CLI under their names, with their arguments and options:
`init`, `upgrade`, `fetch`, `close`, `create-buffer`, `set-buffer-authority`, `write-buffer`, `convert`, `type`,
`build`, and `fetch-historical`. A name that CLI does not have is no subcommand: the terminal SHALL print the usage
of `anchor idl` and send nothing. `authority`, `set-authority`, `erase-authority`, and `set-buffer` are such names.

#### Scenario: Help lists the subcommands (manual)

- **WHEN** the user runs `anchor idl --help`
- **THEN** the terminal lists the eleven subcommands and none of `authority`, `set-authority`, `erase-authority`,
  and `set-buffer`

#### Scenario: A name Anchor 1.1.2 removed (manual)

- **WHEN** no wallet is connected and the user runs `anchor idl set-authority`
- **THEN** the terminal prints the usage of `anchor idl`, asks no wallet question, and sends no transaction

### Requirement: anchor idl takes its cluster, wallet, and files from the Playground

Every subcommand SHALL act on the cluster selected in Settings and SHALL sign with the connected wallet. Anchor's
`--provider.cluster`, `--provider.wallet`, and `--commitment` SHALL NOT be accepted. A path argument or option SHALL
name a file of the project. A subcommand that sends a transaction SHALL accept Anchor's `--priority-fee`, a price in
micro-lamports per compute unit, and SHALL ask the wallet for one approval that covers every transaction.

#### Scenario: A cluster option is refused (manual)

- **WHEN** the user runs `anchor idl fetch <PROGRAM_ID> --provider.cluster devnet`
- **THEN** the terminal prints its unknown-option error and sends no transaction

#### Scenario: One approval from an external wallet (manual)

- **WHEN** an external wallet is connected and an upload needs more than one transaction
- **THEN** the wallet asks for one approval that covers every transaction

#### Scenario: An output option writes a project file (manual)

- **WHEN** the user runs `anchor idl fetch <PROGRAM_ID> --out idl/fetched.json` for a program with a published IDL
- **THEN** the project holds `idl/fetched.json` with that IDL

### Requirement: anchor idl init and upgrade publish an IDL

`anchor idl init` and `anchor idl upgrade` SHALL write an IDL to the canonical Program Metadata account (seed `idl`)
of a program on the selected cluster, creating the account or replacing the IDL it holds. The IDL SHALL be the file
`--filepath` names, or without that option the latest IDL uploaded to the project. On success the command SHALL
print Anchor's line, `IDL initialized.` or `IDL upgraded.`, and the account's address.

#### Scenario: A first upload on Devnet (manual)

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

#### Scenario: A failed upload names the rent it leaves (manual)

- **WHEN** `anchor idl init` sends its first transaction and a later one fails
- **THEN** the terminal prints the failure, then a line naming the SOL held at the canonical address and saying that
  running `anchor idl init` again finishes the upload
- **AND** the memory provider records `idl_upload_failed` with `reason: "unfinished"`

#### Scenario: Running init again finishes the upload

- **WHEN** a buffer of an unfinished upload sits at the canonical address and its authority runs `anchor idl init`
  again
- **THEN** the terminal prints `IDL initialized.`, the address holds a metadata account with the IDL, and
  `anchor idl fetch <PROGRAM_ID>` prints it

#### Scenario: Fetch does not print a buffer (manual)

- **WHEN** a buffer of an unfinished upload sits at the canonical address and the user runs
  `anchor idl fetch <PROGRAM_ID>`
- **THEN** the terminal prints the line that the program has no published IDL, then a line saying an upload to it is
  unfinished, and no buffer bytes

#### Scenario: Close recovers the rent of an unfinished upload (manual)

- **WHEN** a buffer of an unfinished upload sits at the canonical address and the upgrade authority runs
  `anchor idl close <PROGRAM_ID>`
- **THEN** the buffer is closed, its rent less the fee returns to the wallet, and the terminal prints
  `Metadata account closed successfully.`

### Requirement: anchor idl init and upgrade choose the program as Anchor does

The program SHALL be the `PROGRAM_ID` argument. Without one it SHALL be the `address` of the IDL file `--filepath`
names, as in Anchor, or the project's program id when no file is given. Without an argument and without a file,
when the project has no program id, the command SHALL end with one terminal line saying so and SHALL send no
transaction and no event.

#### Scenario: A program id argument (manual)

- **WHEN** the user runs `anchor idl init <PROGRAM_ID>` with the id of a program whose upgrade authority is the
  connected wallet
- **THEN** the IDL is written for that program, not for the project's program id

#### Scenario: The address of an IDL file (manual)

- **WHEN** the user runs `anchor idl init --filepath idl/other.json` without a program id, and the file's `address`
  is a program whose upgrade authority is the connected wallet
- **THEN** the IDL is written for the program at that `address`, not for the project's program id

#### Scenario: No program id to write for (manual)

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

#### Scenario: A wallet that is not the authority publishes its own IDL (manual)

- **WHEN** the connected wallet is not the program's upgrade authority and the user runs
  `anchor idl init --non-canonical <PROGRAM_ID>`
- **THEN** the terminal prints `IDL initialized.`
- **AND** `anchor idl fetch <PROGRAM_ID> --non-canonical` with the same wallet prints that IDL

#### Scenario: The upgrade authority asks for a non-canonical account (manual)

- **WHEN** the connected wallet is the program's upgrade authority and the user runs
  `anchor idl init --non-canonical <PROGRAM_ID>`
- **THEN** the terminal prints one line saying to run the command without `--non-canonical`, and no transaction is
  sent

### Requirement: anchor idl init and upgrade skip a local validator

On an endpoint whose URL contains `localhost` or `127.0.0.1`, `anchor idl init` and `anchor idl upgrade` SHALL print
Anchor's line, `Skipping IDL initialization on localnet` or `Skipping IDL upgrade on localnet`, and SHALL send no
transaction and no event.

#### Scenario: Init on Localnet (manual)

- **WHEN** the selected cluster is Localnet and the user runs `anchor idl init`
- **THEN** the terminal prints `Skipping IDL initialization on localnet`, and no transaction is sent

### Requirement: An upload refuses without a usable IDL or the upgrade authority

Before any transaction, `anchor idl init` and `anchor idl upgrade` SHALL end with one terminal line and send nothing
when there is no IDL to upload, the IDL is not in the Anchor 0.30+ format, the program is not deployed on the selected
cluster, the program has no upgrade authority, or the connected wallet is not that authority. The line SHALL say
which, and for a wrong wallet SHALL name the authority. With `--non-canonical` the two authority conditions SHALL
NOT apply.

#### Scenario: No IDL in the project (manual)

- **WHEN** no IDL was uploaded to the project and the user runs `anchor idl init` without `--filepath`
- **THEN** the terminal prints one line saying the project has no IDL, and no transaction is sent

#### Scenario: A missing IDL file (manual)

- **WHEN** the project holds no `idl/none.json` and the user runs `anchor idl init --filepath idl/none.json`
- **THEN** the terminal prints one line naming that path, and no transaction is sent

#### Scenario: An Anchor 0.29 IDL (manual)

- **WHEN** the latest IDL uploaded to the project is in the Anchor 0.29 format and the user runs `anchor idl init`
- **THEN** the terminal prints one line saying the IDL is not in the Anchor 0.30+ format, and no transaction is sent

#### Scenario: A wallet that is not the authority (manual)

- **WHEN** the connected wallet is not the program's upgrade authority and the user runs `anchor idl upgrade`
- **THEN** the terminal prints one line naming the upgrade authority, and no transaction is sent

#### Scenario: A program that is not deployed (manual)

- **WHEN** the program id has no program on the selected cluster and the user runs `anchor idl init`
- **THEN** the terminal prints one line saying the program is not deployed there, and no transaction is sent

### Requirement: anchor idl fetch prints a published IDL

`anchor idl fetch <PROGRAM_ID>` SHALL read the program's canonical Program Metadata account (seed `idl`) on the
selected cluster and print its content, or with `--out` write the content to that file and print the line of the
client Anchor runs, `Metadata content saved to` and the path. With `--non-canonical` it SHALL read the account of
the connected wallet instead. It SHALL send no transaction, SHALL need a wallet only with
`--non-canonical`, and SHALL end with one terminal line when the program has no such account.

#### Scenario: Fetch after an upload (manual)

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

#### Scenario: Close returns the rent (manual)

- **WHEN** the connected wallet is the upgrade authority of a program with a published IDL on Devnet and the user
  runs `anchor idl close <PROGRAM_ID>`
- **THEN** the terminal prints `Metadata account closed successfully.`, and the wallet's balance grows by the
  account's rent less the fee
- **AND** `anchor idl fetch <PROGRAM_ID>` says the program has no published IDL

#### Scenario: Close by another wallet (manual)

- **WHEN** the connected wallet is not the program's upgrade authority and the user runs
  `anchor idl close <PROGRAM_ID>`
- **THEN** the terminal prints one line naming the upgrade authority, and no transaction is sent

### Requirement: anchor idl create-buffer stores an IDL in a buffer

`anchor idl create-buffer` SHALL create a Program Metadata buffer account that holds the IDL of the file
`--filepath` names, or without that option the latest IDL uploaded to the project, with the connected wallet as the
buffer's authority. It SHALL print Anchor's line, `Buffer created successfully.`, and the buffer's address.

#### Scenario: A buffer from the project's IDL (manual)

- **WHEN** an IDL was uploaded to the project and the user runs `anchor idl create-buffer` on Devnet
- **THEN** the terminal prints `Buffer created successfully.` and an address
- **AND** the account at that address is a Program Metadata buffer whose authority is the connected wallet

### Requirement: anchor idl set-buffer-authority hands a buffer over

`anchor idl set-buffer-authority <BUFFER> --new-authority <NEW_AUTHORITY>` SHALL set the authority of that buffer
and print Anchor's line, `Buffer authority set successfully.` Before any transaction it SHALL end with one terminal
line and send nothing when the buffer does not exist or its authority is not the connected wallet.

#### Scenario: A buffer gets a new authority (manual)

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

### Requirement: anchor idl convert converts an IDL file between formats

`anchor idl convert <PATH>` SHALL print the IDL of that file converted from the legacy format, before Anchor 0.30, to
the current one, and with `--to-legacy` from the current format to the legacy one. `--program-id` SHALL set the
program id of the result, and `--out` SHALL write the result to that file. The result SHALL equal what Anchor
1.1.2's CLI prints for the same file and options. The subcommand SHALL send no transaction and need no wallet.

#### Scenario: A legacy IDL is converted (manual)

- **WHEN** the project holds `idl/legacy.json` in the legacy format and the user runs
  `anchor idl convert idl/legacy.json --program-id <PROGRAM_ID>`
- **THEN** the terminal prints the IDL in the current format with that program id as its `address`
- **AND** the output equals what `anchor idl convert` of Anchor 1.1.2 prints for the same file and options

### Requirement: anchor idl type prints an IDL's TypeScript type

`anchor idl type <PATH>` SHALL print the TypeScript type of the IDL in that file, as Anchor 1.1.2's CLI prints it,
or with `--out` write it to that file. The subcommand SHALL send no transaction and need no wallet.

#### Scenario: A type from an IDL file (manual)

- **WHEN** the project holds `idl/counter.json` in the current format and the user runs
  `anchor idl type idl/counter.json`
- **THEN** the terminal prints what `anchor idl type` of Anchor 1.1.2 prints for the same file

### Requirement: anchor idl build and fetch-historical are not supported yet

`anchor idl build` and `anchor idl fetch-historical` SHALL end on every cluster with one terminal line saying the
Playground terminal does not support the subcommand yet. They SHALL send no transaction and SHALL NOT ask for a
wallet.

#### Scenario: anchor idl build (manual)

- **WHEN** no wallet is connected and the user runs `anchor idl build`
- **THEN** the terminal prints the not-supported line, asks no wallet question, and sends no transaction

### Requirement: anchor legacy-idl offers fetch and close

`anchor legacy-idl` SHALL offer `fetch` and `close` of Anchor 1.1.2's `legacy-idl`, with their arguments and
options, under the rule "anchor idl takes its cluster, wallet, and files from the Playground". The other seven,
`init`, `upgrade`, `authority`, `write-buffer`, `set-buffer`, `set-authority`, and `erase-authority`, are not
supported: they are no subcommand, so help does not list them and the terminal prints the usage of
`anchor legacy-idl` and sends nothing. Before `fetch` or `close` runs, the terminal SHALL print Anchor's line
`warning: You are using a deprecated legacy IDL command.` with the rest of its text; a line that asks for help prints
none.

#### Scenario: Help lists two legacy subcommands

- **WHEN** the user runs `anchor legacy-idl --help`
- **THEN** the terminal lists `fetch` and `close`, and none of the other seven

#### Scenario: A legacy write is not supported (manual)

- **WHEN** the user runs `anchor legacy-idl init <PROGRAM_ID>`
- **THEN** the terminal prints the usage of `anchor legacy-idl`, asks no wallet question, and sends no transaction

### Requirement: anchor legacy-idl fetch prints the Anchor IDL account

`anchor legacy-idl fetch <ADDRESS>` SHALL read the Anchor IDL account the address names: for a program, the account
derived from it; for any other address, that account, an IDL buffer included. It SHALL print the decompressed IDL,
or with `--out` write it to that project file, send no transaction, need no wallet, and end with one terminal line
when no such account exists.

#### Scenario: An older program's IDL (manual)

- **WHEN** a program has an Anchor IDL account on Devnet, no wallet is connected, and the user runs
  `anchor legacy-idl fetch <PROGRAM_ID>`
- **THEN** the terminal prints that IDL's JSON and asks no wallet question

#### Scenario: A program without an Anchor IDL account (manual)

- **WHEN** the program has no Anchor IDL account and the user runs `anchor legacy-idl fetch <PROGRAM_ID>`
- **THEN** the terminal prints one line saying the program has no legacy IDL

### Requirement: anchor legacy-idl close closes the Anchor IDL account

`anchor legacy-idl close <PROGRAM_ID>` SHALL close the program's Anchor IDL account, or the one `--idl-address`
names, through the program's own IDL instruction, send its rent to the connected wallet, and print Anchor's line.
Before any transaction it SHALL end with one terminal line and send nothing when the account does not exist or the
connected wallet is not its authority. `--print-only` SHALL NOT be accepted.

#### Scenario: Close an older program's IDL (manual)

- **WHEN** the connected wallet is the authority of a program's Anchor IDL account on Devnet and the user runs
  `anchor legacy-idl close <PROGRAM_ID>`
- **THEN** the terminal prints Anchor's line, the account no longer exists, and its rent less the fee returns to
  the wallet

#### Scenario: Close by another wallet (manual)

- **WHEN** the connected wallet is not the Anchor IDL account's authority and the user runs
  `anchor legacy-idl close <PROGRAM_ID>`
- **THEN** the terminal prints one line naming the authority, and no transaction is sent

### Requirement: An IDL upload sends its events

The `program-idl` slice SHALL send, with prefix `idl`: `idl_upload_started { target, cluster }` when an upload starts,
before its checks; `idl_uploaded { target, cluster }` when every transaction is confirmed; and
`idl_upload_failed { target, cluster, reason }` when the upload ends any other way. `target` is `metadata`. `cluster`
is the endpoint's cluster, or `custom` for a custom RPC. A command refused on mainnet SHALL send `idl_upload_started`
and then `idl_upload_failed`, so that attempts on mainnet can be counted. No event SHALL carry an address, a
signature, or the IDL.

#### Scenario: A successful upload is tracked (manual)

- **WHEN** `anchor idl init` succeeds on Devnet
- **THEN** the memory provider records `idl_upload_started` and then `idl_uploaded`, both with
  `{ target: "metadata", cluster: "devnet" }`

#### Scenario: An upload through a custom RPC is tracked

- **WHEN** the endpoint is a custom RPC that serves Devnet, a URL that is none of the Playground's own endpoints
  (`CLUSTERS`), and `anchor idl init` succeeds
- **THEN** the memory provider records `idl_upload_started` and then `idl_uploaded`, both with
  `{ target: "metadata", cluster: "custom" }`, not `devnet`

#### Scenario: A mainnet refusal is tracked (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs `anchor idl init`
- **THEN** the memory provider records `idl_upload_started` with `{ target: "metadata", cluster: "mainnet-beta" }`
  and then `idl_upload_failed` with `{ target: "metadata", cluster: "mainnet-beta", reason: "mainnet" }`
- **AND** no transaction is sent

### Requirement: A failed upload names its reason

`idl_upload_failed` SHALL carry one `reason`: `not_found` when there is no IDL to upload, `invalid` when the IDL is
not in the Anchor 0.30+ format, `not_deployed` when the program is not on the cluster, `authority` when the program
has no upgrade authority or the wallet is not it, `rejected` when the wallet declines the approval, `mainnet` when
the command is refused because the endpoint is mainnet-beta, `unfinished` when a failed send leaves a buffer the
terminal names, `send_failed` for any other failure after the first transaction was sent, and `rpc` for any other
failure before it, an endpoint that does not say which network it serves included.

#### Scenario: A wrong wallet is tracked (manual)

- **WHEN** the connected wallet is not the upgrade authority and the user runs `anchor idl init` on Devnet
- **THEN** the memory provider records `idl_upload_failed` with
  `{ target: "metadata", cluster: "devnet", reason: "authority" }`

#### Scenario: A declined approval is tracked (manual)

- **WHEN** the user declines the wallet's approval of an upload
- **THEN** the memory provider records `idl_upload_failed` with `reason: "rejected"`, and no transaction is sent

### Requirement: The other on-chain subcommands send their events

For `fetch`, `close`, `create-buffer`, `set-buffer-authority`, and `write-buffer`, and for `anchor legacy-idl`'s
`fetch` and `close` as `legacy-fetch` and `legacy-close`, the `program-idl` slice SHALL send, with prefix `idl`: `idl_command_started { command, cluster }` when the subcommand starts, before its checks;
`idl_command_succeeded { command, cluster }` when it ends as its requirement says; and
`idl_command_failed { command, cluster, reason }` when it ends any other way. `command` is the subcommand's name, and
`cluster` is as in the upload events. A command refused on mainnet SHALL send `idl_command_started` and then
`idl_command_failed`. No event SHALL carry an address, a signature, a path, or an IDL.

#### Scenario: A fetch is tracked (manual)

- **WHEN** `anchor idl fetch <PROGRAM_ID>` prints an IDL on Devnet
- **THEN** the memory provider records `idl_command_started` and then `idl_command_succeeded`, both with
  `{ command: "fetch", cluster: "devnet" }`

### Requirement: A failed subcommand names its reason

`idl_command_failed` SHALL carry one `reason`: `not_found` when the IDL, file, or account the subcommand needs does
not exist, `invalid` when the IDL is not in the Anchor 0.30+ format, `not_deployed` when the program is not on the
cluster, `authority` when the connected wallet may not act on the account, `rejected` when the wallet declines the
approval, `mainnet` when the command is refused because the endpoint is mainnet-beta, `unfinished` when a failed send
leaves a buffer the terminal names, `send_failed` for any other failure after the first transaction was sent, `rpc`
for any other failure before it, and `unsupported` for `build` and `fetch-historical`, which send this event alone,
with their name as `command`.

#### Scenario: A close refused on mainnet is tracked (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs `anchor idl close <PROGRAM_ID>`
- **THEN** the memory provider records `idl_command_started` and then `idl_command_failed` with
  `{ command: "close", cluster: "mainnet-beta", reason: "mainnet" }`, and no transaction is sent

#### Scenario: A fetch without a published IDL is tracked (manual)

- **WHEN** the program has no published IDL and the user runs `anchor idl fetch <PROGRAM_ID>` on Devnet
- **THEN** the memory provider records `idl_command_failed` with
  `{ command: "fetch", cluster: "devnet", reason: "not_found" }`

#### Scenario: An unsupported subcommand is tracked (manual)

- **WHEN** the user runs `anchor idl fetch-historical <PROGRAM_ID>` on Devnet
- **THEN** the memory provider records `idl_command_failed` with
  `{ command: "fetch-historical", cluster: "devnet", reason: "unsupported" }` and no `idl_command_started`
