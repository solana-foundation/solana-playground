## ADDED Requirements

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
ask "Playground Wallet is not connected. Connect it? [Y/n]" before it does
anything else. A command that takes any wallet and finds none SHALL ask "No
wallet is connected. Connect the Playground Wallet? [Y/n]". A yes SHALL
connect the Playground Wallet and the command SHALL go on. A no SHALL end
the command with "Run `connect` to connect a wallet, then try again." and no
"Process error:" prefix.

#### Scenario: The wallet question (manual)

- **WHEN** no wallet is connected and the person types `solana balance`
- **THEN** the terminal asks "Playground Wallet is not connected. Connect it?
  [Y/n]", and Enter connects the wallet and runs the command

#### Scenario: The wallet question declined (manual)

- **WHEN** the terminal asks the wallet question and the person answers `n`
- **THEN** the command ends with "Run `connect` to connect a wallet, then try
  again."
