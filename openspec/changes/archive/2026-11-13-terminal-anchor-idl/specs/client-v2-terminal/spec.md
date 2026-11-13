## ADDED Requirements

### Requirement: Spaces separate a command's arguments

The terminal SHALL split a typed line into a command's arguments at spaces outside quotes, with a run of spaces
separating as one space does, and with no argument for spaces at the start or the end of the line. A quoted empty
string (`""` or `''`) SHALL be an empty argument. `!!` SHALL expand to the previous line split the same way. Every
command SHALL receive its arguments by this rule.

#### Scenario: Two spaces before an option (manual)

- **WHEN** the person types `anchor idl init <PROGRAM_ID>  --filepath idl.json` with two spaces before the option
- **THEN** the command runs as it does with one space, with no "Unexpected argument" error

## MODIFIED Requirements

### Requirement: Offline, a command that needs a connection says so at once

While the browser is offline, a command that needs the server or a cluster
(`build`, `deploy`, `airdrop`, `run`, `test`, `anchor`, `solana`,
`spl-token`, `sugar`) SHALL end at once with "You're offline. This command
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
  types `solana balance`
- **THEN** the terminal prints the offline line and asks no wallet question
