# Spec Delta

## MODIFIED Requirements

### Requirement: Offline, a command that needs a connection says so at once

While the browser is offline, a command that needs the server or a cluster
(`build`, `deploy`, `airdrop`, `run`, `test`, `anchor`, `solana`,
`spl-token`) SHALL end at once with "You're offline. This command
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


## ADDED Requirements

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
