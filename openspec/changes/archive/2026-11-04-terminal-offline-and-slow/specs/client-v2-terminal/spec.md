# Spec Delta

## ADDED Requirements

### Requirement: Offline, a command that needs a connection says so at once

While the browser is offline, a command that needs the server or a cluster
(`build`, `deploy`, `airdrop`, `run`, `test`, `anchor`, `solana`,
`spl-token`, `sugar`) SHALL end at once with "You're offline. This command
needs a connection." in the terminal's error colour, with no "Process
error:" prefix, before it asks any
question or does any work. `help`, `clear`, `setting`, `connect`, `prettier`
and `rustfmt` SHALL run as they do online, and so SHALL any command asked for
its help (`--help`, `-h`). Anything else that starts such a command, such as
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
