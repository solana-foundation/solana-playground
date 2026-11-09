## ADDED Requirements

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
