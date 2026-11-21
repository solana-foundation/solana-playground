# Spec Delta

## MODIFIED Requirements

### Requirement: A command that needs a wallet asks for one

A command that needs the Playground Wallet and finds none connected SHALL
ask "Your Playground wallet is not connected. Connect it? [Y/n]" before it does
anything else. A command that takes any wallet and finds none SHALL ask "No
wallet is connected. Connect the Playground wallet? [Y/n]". A yes SHALL
connect the Playground Wallet and the command SHALL go on. A no SHALL end
the command with "Run `connect` to connect a wallet, then try again." and no
"Process error:" prefix.

#### Scenario: The wallet question (manual)

- **WHEN** no wallet is connected and the person types `solana program show
  --buffers`
- **THEN** the terminal asks "Your Playground wallet is not connected. Connect it?
  [Y/n]", and Enter connects the wallet and runs the command

#### Scenario: The wallet question declined (manual)

- **WHEN** the terminal asks the wallet question and the person answers `n`
- **THEN** the command ends with "Run `connect` to connect a wallet, then try
  again."

### Requirement: Offline, a command that needs a connection says so at once

While the browser is offline, a command that needs the server or a cluster
(`build`, `deploy`, `airdrop`, `run`, `test`, `anchor`, `solana`) SHALL end
at once with "You're offline. This command
needs a connection." in the terminal's error colour, with no "Process
error:" prefix, before it asks any
question or does any work. `help`, `clear`, `setting`, `connect`, `prettier`
and `rustfmt` SHALL run as they do online, and so SHALL any command asked for
its help (`--help`, `-h`) and `anchor` asked for its version (`--version`,
`-V`). Anything else that starts such a command, such as
the assistant or the wallet's airdrop, SHALL end the same way.

#### Scenario: Build offline

- **WHEN** the browser is offline and the person types `build`
- **THEN** the terminal prints "You're offline. This command needs a
  connection." and the build does not start

#### Scenario: Help offline

- **WHEN** the browser is offline and the person types `help`
- **THEN** the terminal lists the commands

#### Scenario: A wallet command offline asks nothing first (manual)

- **WHEN** the browser is offline, no wallet is connected and the person
  types `solana program close --buffers`
- **THEN** the terminal prints the offline line and asks no wallet question

## ADDED Requirements

### Requirement: The terminal offers no spl-token command

The terminal SHALL NOT offer the `spl-token` command. `help` SHALL NOT list
it, and typing `spl-token`, with or without arguments, SHALL end with the
unknown-command line, "`spl-token` is not a command. Type `help` to see
commands.", sending no transaction.

#### Scenario: Typing spl-token

- **WHEN** the person types `spl-token --help`
- **THEN** the terminal prints "`spl-token` is not a command. Type `help` to
  see commands." in `error`, and runs nothing

### Requirement: solana offers three subcommands

The `solana` command SHALL offer `confirm`, `program show --buffers` and
`program close --buffers`, and nothing else. `solana` alone or with `--help`
SHALL list `confirm` and `program`. Any other subcommand SHALL end with
"Subcommand doesn't exist: `<name>`" followed by the available subcommands,
asking no wallet question and sending nothing.

#### Scenario: An unknown solana subcommand

- **WHEN** the person types `solana balance`
- **THEN** the terminal prints "Subcommand doesn't exist: `balance`" and
  names `confirm` and `program` as the available subcommands, and asks no
  wallet question

#### Scenario: solana help

- **WHEN** the person types `solana --help`
- **THEN** the terminal lists `confirm` and `program`

### Requirement: solana commands take the cluster with -u

Each `solana` subcommand SHALL read the cluster from `-u` or `--url` when
given, and from the endpoint selected in the app otherwise. `-u` SHALL take
a URL, or one of `mainnet-beta`, `testnet`, `devnet`, `localhost` and their
first letters `m`, `t`, `d`, `l`, which stand for the cluster's public RPC
URL. The option SHALL NOT change the endpoint selected in the app.

#### Scenario: A cluster name (manual)

- **WHEN** Mainnet Beta is selected and the person types `solana confirm -u d
  <signature>` for a Devnet transaction
- **THEN** the command reads `https://api.devnet.solana.com`, reports the
  transaction's status, and the app still has Mainnet Beta selected

#### Scenario: A URL (manual)

- **WHEN** the person types `solana program show --buffers -u
  'https://devnet.helius-rpc.com/?api-key=k'`
- **THEN** the command reads the buffers from that URL

### Requirement: solana confirm reports a transaction's status

`solana confirm <signature>` SHALL print the signature's confirmation status
(`Processed`, `Confirmed` or `Finalized`), "Transaction failed: " followed by
the error when the transaction failed, or "Not found" when the cluster does
not know the signature. With `-v` or `--verbose` it SHALL first print the
transaction: its slot, block time, accounts, instructions, status, fee,
balances and log messages, as the Solana CLI prints them. It SHALL ask for
no wallet.

#### Scenario: A successful transaction (manual)

- **WHEN** no wallet is connected and the person types `solana confirm -v
  <signature>` for a successful Devnet transaction
- **THEN** the terminal prints the transaction with its log messages, then
  `Finalized` (or `Confirmed` while it is not yet final), and asks no wallet
  question

#### Scenario: A failed transaction (manual)

- **WHEN** the person types `solana confirm -v <signature>` for a failed
  transaction
- **THEN** the terminal prints the transaction with its log messages, then
  "Transaction failed: " followed by the error

#### Scenario: An unknown signature (manual)

- **WHEN** the person types `solana confirm <signature>` for a signature the
  cluster does not know
- **THEN** the terminal prints "Not found"

#### Scenario: Interact prints the details (manual)

- **WHEN** "Transaction details in the terminal" is on and an Interact call
  lands
- **THEN** the terminal prints the call's transaction as `solana confirm -v`
  does

### Requirement: solana program show --buffers lists the wallet's buffers

`solana program show --buffers` SHALL list every upgradeable-loader buffer
whose authority is the Playground Wallet, one row per buffer with its
address, its authority and its balance in SOL, under the header "Buffer
Address | Authority | Balance". With no buffer it SHALL print "No buffers.".
It SHALL send no transaction. `solana program show` without `--buffers`
SHALL end with an error that names `--buffers`.

#### Scenario: Two buffers (manual)

- **WHEN** the Playground Wallet is the authority of two buffers on the
  selected cluster and the person types `solana program show --buffers`
- **THEN** the terminal prints the header and one row per buffer

#### Scenario: No buffer (manual)

- **WHEN** the Playground Wallet holds no buffer and the person types `solana
  program show --buffers`
- **THEN** the terminal prints "No buffers."

### Requirement: solana program close --buffers reclaims the wallet's buffers

`solana program close --buffers` SHALL close every buffer whose authority is
the Playground Wallet, sending each buffer's SOL to that wallet. It SHALL
then list the buffers it closed as `program show --buffers` lists them, or
print "No buffers." when it closed none. A buffer whose close fails SHALL be
left out of the list and the others SHALL still close. `solana program close`
without `--buffers` SHALL end with an error that names `--buffers`.

#### Scenario: Reclaiming a stopped deploy's buffer (manual)

- **WHEN** a deploy stopped after its buffer was created and the person types
  the command the terminal printed, `solana program close --buffers -u
  '<url>'`
- **THEN** the buffer is closed, its SOL is back in the Playground Wallet, and
  the terminal lists the buffer it closed

#### Scenario: Nothing to close (manual)

- **WHEN** the Playground Wallet holds no buffer and the person types `solana
  program close --buffers`
- **THEN** the terminal prints "No buffers." and sends no transaction
