# client-v2-terminal Specification

## Purpose

How the terminal answers a command it does not know, how it asks a yes or
no question, the wallet question included, and what it says when a command
cannot reach the network or stays quiet.

## Requirements

### Requirement: An unknown command suggests the closest one

A command the terminal does not know SHALL end with one line and no
"Process error:" prefix. The typed word SHALL be matched in any case and
shown as typed:

- when a known command is 2 edits or fewer away (insert, delete, replace or
  swap two neighbours): "`<typed>` is not a command. Did you mean
  `<command>`?", naming the closest command, and the earliest in `help`'s
  order on a tie;
- when the typed word is `ls`, `cd`, `cat`, `npm`, `yarn` or `cargo`: "This
  terminal runs Playground commands, not a system shell. Type `help` to see
  them.";
- otherwise: "`<typed>` is not a command. Type `help` to see commands."

Each answer SHALL report `unknown_command_answered` with which of the three it
was, never the typed word.

After a suggestion, Up at the empty prompt SHALL bring back the suggested
command, so Enter runs it. The terminal SHALL take new input at once.

#### Scenario: A typo gets a suggestion

- **WHEN** the person types `biuld` and presses Enter
- **THEN** the terminal prints "`biuld` is not a command. Did you mean
  `build`?" with no "Process error:"

#### Scenario: Up brings back the suggestion

- **WHEN** the terminal has just suggested `build` and the person presses Up
- **THEN** the prompt holds `build`

#### Scenario: A shell habit is named as one

- **WHEN** the person types `ls` and presses Enter
- **THEN** the terminal prints "This terminal runs Playground commands, not a
  system shell. Type `help` to see them."

#### Scenario: Nothing close

- **WHEN** the person types `xyzzy` and presses Enter
- **THEN** the terminal prints "`xyzzy` is not a command. Type `help` to see
  commands."

### Requirement: A yes or no question shows its default in capitals

Every yes or no question the terminal asks SHALL end with `[Y/n]` when its
default is yes, `[y/N]` when it is no, and `[y/n]` when it has none, and
SHALL not add "(default: …)". It SHALL take `y`, `yes`, `n` and `no` in any
case. Enter on an empty answer SHALL take the default; with no default it
SHALL ask again. Any other answer SHALL say it is not a valid value and ask
again.

#### Scenario: Enter takes the default (manual)

- **WHEN** the terminal asks a question ending in `[Y/n]` and the person
  presses Enter
- **THEN** the answer is yes

#### Scenario: A short answer in capitals (manual)

- **WHEN** the terminal asks a question ending in `[y/N]` and the person
  types `Y`
- **THEN** the answer is yes

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

### Requirement: A quiet run says it is taking longer

A running command that prints nothing for 10 seconds SHALL get the line
"This is taking longer than usual." once, in the terminal's info colour (the
running command's progress, nothing has failed). Any output SHALL restart the 10
seconds. Time the terminal spends waiting for the person's answer to a
question SHALL not count. A command that another command runs (a deploy
that builds first) SHALL not add a second line. The command SHALL keep
running.

#### Scenario: A slow build (manual)

- **WHEN** the person types `build` on Chrome's "Slow 4G" and the server
  takes more than 10 seconds to answer
- **THEN** the terminal prints "This is taking longer than usual." once, and
  the build goes on and ends with its own result

#### Scenario: A quick command (manual)

- **WHEN** a command ends within 10 seconds
- **THEN** the terminal prints no slow line

### Requirement: A terminal line takes its variant by its meaning

The terminal SHALL print a line that is not command output in the design
system's terminal line variant for its meaning: a refused command or a failure
in `error`, a notice in `warning`, progress in `info`, and a finished result in
`success`. Command output SHALL stay plain. The words of a line SHALL NOT change
with its variant, and what a button toast or the assistant reads SHALL carry no
colour codes.

#### Scenario: An unknown command is an error (manual)

- **WHEN** the person types `biuld`
- **THEN** "`biuld` is not a command. Did you mean `build`?" prints in `error`

#### Scenario: A shell habit is an error (manual)

- **WHEN** the person types `ls`
- **THEN** "This terminal runs Playground commands, not a system shell. Type
  `help` to see them." prints in `error`

#### Scenario: A declined wallet question is an error (manual)

- **WHEN** a command asks to connect the wallet and the person answers no
- **THEN** "Run `connect` to connect a wallet, then try again." prints in `error`

#### Scenario: A command that fails is an error (manual)

- **WHEN** a command throws
- **THEN** its "Process error: ..." line prints in `error`

#### Scenario: A step that cannot be stopped is a warning (manual)

- **WHEN** the person presses Ctrl+C during a step that cannot be stopped
- **THEN** `^C` prints plain and "This step can't be stopped. Wait for it to
  finish." prints in `warning`

#### Scenario: A stopped run is a warning (manual)

- **WHEN** a run ends because the person stopped it
- **THEN** its "Stopped." line prints in `warning`

#### Scenario: Stopping after a step is progress (manual)

- **WHEN** the person stops a deploy that ends at a safe point
- **THEN** "Stopping after this step…" prints in `info`

#### Scenario: A deploy notice is a warning (manual)

- **WHEN** a deploy prints "Warning: Program is not built."
- **THEN** the line prints in `warning`

#### Scenario: A finished result is a success (manual)

- **WHEN** an airdrop finishes
- **THEN** "Airdrop successful." prints in `success`

#### Scenario: Command output stays plain (manual)

- **WHEN** a build prints the compiler's output
- **THEN** the terminal adds no variant to it

### Requirement: Spaces separate a command's arguments

The terminal SHALL split a typed line into a command's arguments at spaces outside quotes, with a run of spaces
separating as one space does, and with no argument for spaces at the start or the end of the line. A quoted empty
string (`""` or `''`) SHALL be an empty argument. `!!` SHALL expand to the previous line split the same way. Every
command SHALL receive its arguments by this rule.

#### Scenario: Two spaces before an option (manual)

- **WHEN** the person types `anchor idl init <PROGRAM_ID>  --filepath idl.json` with two spaces before the option
- **THEN** the command runs as it does with one space, with no "Unexpected argument" error

### Requirement: The terminal offers no sugar command

The terminal SHALL NOT offer Metaplex's `sugar` (Candy Machine) command until
its subcommands are validated on Devnet. `help` SHALL NOT list it, and typing
`sugar`, with or without arguments, SHALL end with the unknown-command line,
"`sugar` is not a command. Type `help` to see commands.", sending no
transaction.

#### Scenario: Typing sugar

- **WHEN** the person types `sugar --help`
- **THEN** the terminal prints "`sugar` is not a command. Type `help` to see
  commands." in `error`, and runs nothing

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
