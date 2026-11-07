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

- **WHEN** no wallet is connected and the person types `solana balance`
- **THEN** the terminal asks "Your Playground wallet is not connected. Connect it?
  [Y/n]", and Enter connects the wallet and runs the command

#### Scenario: The wallet question declined (manual)

- **WHEN** the terminal asks the wallet question and the person answers `n`
- **THEN** the command ends with "Run `connect` to connect a wallet, then try
  again."

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
