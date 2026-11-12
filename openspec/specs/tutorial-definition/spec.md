# tutorial-definition Specification

## Purpose
How a conversation tutorial is written down: the `tutorial.json` definition, its schema and the check that accepts or names every error in it, so a tutorial can be authored without touching code.

## Requirements

### Requirement: A step can pass on a refused call

A step's goal MAY be `refused`: a call of the named instruction that the
program refused. The goal SHALL name what the refusal looks like with at least
one of:

- a program error, by its name, its code or both (`NotEnoughEnergy`, `6000`);
- a pattern the transaction's log matches, for a refusal with no error code
  such as a panic or running out of memory.

`yarn tutorial:check` SHALL reject a `refused` goal that names neither, an
error that has neither a name nor a code, an instruction no step's target
defines, and a log pattern that is not a regular expression, each at its path.

#### Scenario: Lumberjack's step 3 as a definition (manual)

- **WHEN** a step's goal is `refused` with instruction `chop_tree` and error
  `NotEnoughEnergy` 6000
- **THEN** `yarn tutorial:check` accepts it

#### Scenario: A refused goal that says nothing (manual)

- **WHEN** a step's goal is `refused` with an instruction and no error and no
  log
- **THEN** `yarn tutorial:check` fails and names the goal's path

### Requirement: A call act can send argument values

Each argument of a call act SHALL be one of:

- a name: the card shows a field for it, which the learner fills;
- a name with a fixed value, a string or a whole number: the card sends it as
  given and shows no field for it;
- a name with a whole number and an amount to add: the first run sends the
  number, and each run of that card that landed adds the amount for the next.
  A run that failed or was refused sends the same value again.

`yarn tutorial:check` SHALL reject an argument named twice on one act and an
amount to add on a value that is not a whole number.

#### Scenario: Paint's fixed values (manual)

- **WHEN** a call act on `paint` gives `text` the value `"gm"` and `at` the
  value `35000`
- **THEN** pressing it sends `text` = `gm` and `at` = `35000`, with no field
  on the card

#### Scenario: Grow's growing size (manual)

- **WHEN** a call act on `grow` gives `len` the value `20480` and adds `10240`
- **THEN** its first run sends `20480`, and after that run lands the next
  sends `30720`
- **AND** after a run that is refused the next sends the same value again

### Requirement: An act can name its record line

An act beat MAY carry its record line, which the card SHALL read once its run
landed, before the time it took ("Created your map · 10 KB"). Without one the
card SHALL read its default record.

#### Scenario: Zero Copy's create card (manual)

- **WHEN** the act `init_map` with record "Created your map · 10 KB" lands
- **THEN** its record reads "Created your map · 10 KB" followed by its time

### Requirement: A write can carry its own reference and start

A write block MAY carry `ref`, the whole file the block lands in, and
`start`, the file as that write finds it. When given, they SHALL stand in for
the step's target and start of that file for that write alone: the block
lands where `ref` has it, and lines of `start` the block replaces go. A write
with neither SHALL land as before, against the step's target and start.

`yarn tutorial:check` SHALL require a block with a `ref` to appear in that
`ref` exactly once, its lines in a row, and SHALL NOT require it to appear in
the step's target. A block absent from its `ref` SHALL fail at the block's
path, and a block that appears in its `ref` more than once SHALL fail at the
`ref`'s path.

#### Scenario: Lumberjack's broken accounts struct (manual)

- **WHEN** a step's write gives `InitPlayer` without `system_program`, a
  block its step's target does not hold, with a `ref` that holds it once
- **THEN** `yarn tutorial:check` accepts it
- **AND** the block lands in `lib.rs` where the `ref` has it, not at the end

#### Scenario: Zero Copy's fix replaces a broken line (manual)

- **WHEN** a question's write gives the boxed `board` field with `ref` the
  fixed file and `start` the broken build
- **THEN** a right pick replaces the unboxed `board` line in place

#### Scenario: A ref that holds the block twice (manual)

- **WHEN** a write's `ref` holds its block's lines twice
- **THEN** `yarn tutorial:check` fails and names the write's `ref`

### Requirement: An act names the account it shows

A `run` or `call` act MAY carry `account`: a `player` view (`name`, `energy`, `wood`, `max`, optional `refill: { seconds, from }`) or a `memory` view (`name`, `capacity`, optional `zero`). `yarn tutorial:check` SHALL refuse `account` on any other act.

#### Scenario: An account on a build (manual)

- **WHEN** a `build` act carries `account`
- **THEN** the check fails naming that act's path

#### Scenario: A chop act with a player view (manual)

- **WHEN** a `call` act names `{ "kind": "player", "name": "player", "energy": "energy", "wood": "wood", "max": 5 }`
- **THEN** the check passes

### Requirement: A call act may repeat

A `call` act MAY have `repeat`: a required `label`, the second button's name,
and an optional `until`, a log pattern read as a goal's `log` is. `yarn
tutorial:check` SHALL refuse `repeat` on any other act, an `until` that does not
compile, an `until` on the step's last beat, an `until` on a card whose step goal
reads the log of the same call, and, with no `until`, a step whose
goal is not a `call` or `refused` goal of the card's own instruction, since
nothing could then end the card.

#### Scenario: A repeat nothing can end (manual)

- **GIVEN** a call act with `repeat` and no `until`, in a step whose goal is `deploy`
- **WHEN** the check runs
- **THEN** it fails with the beat's path and says what would end the card

### Requirement: The check refuses a start that is not the previous target

`yarn tutorial:check` SHALL refuse a step, other than the first, whose `start` differs from the previous step's `target`: a file the target has and the start lacks, a file the start has and the target lacks, or a file whose content differs. Each such file SHALL be one error at `steps[<i>].start["<file>"]` that names the previous step.

#### Scenario: A start retyped with a changed line (manual)
- **WHEN** step 2's `start` holds `src/lib.rs` with one line other than step 1's `target`
- **THEN** the check prints `steps[1].start["src/lib.rs"]: the same file as steps[0].target, found a different one` and exits with code 1

#### Scenario: A start missing a file (manual)
- **WHEN** step 1's `target` holds `client/client.ts` and step 2's `start` does not
- **THEN** the check prints `steps[1].start["client/client.ts"]: the file as steps[0].target has it, found none`

### Requirement: The authoring instruction ships as a skill

The repository SHALL hold a skill, `client-v2/src/tutorials/SKILL.md`, that tells a model to write a tutorial by `AUTHORING.md` and `tutorial.schema.json` and to hand the person a folder the check accepts. It SHALL hold no copy of either file. `yarn tutorial:skill` SHALL pack `SKILL.md`, `AUTHORING.md` and `tutorial.schema.json` into one zip, `tutorial-author.zip`, with the three files in one folder `tutorial-author/`, as Claude installs a skill; uploaded as plain files to any other LLM, the same three files SHALL be enough.

#### Scenario: Packing the skill (manual)
- **WHEN** an author runs `yarn tutorial:skill` in `client-v2/`
- **THEN** `tutorial-author.zip` holds `tutorial-author/SKILL.md`, `tutorial-author/AUTHORING.md` and `tutorial-author/tutorial.schema.json`, each byte for byte as in the repository

### Requirement: An act can be an airdrop

An act beat MAY be `act: "airdrop"`. It names no instruction and no account.
A lesson SHALL carry an airdrop act before every `deploy` or `buildDeploy`
act, since the previous deploy act, in the same step or an earlier one. Beats
are counted in order across steps, each step's own beats before its `onFail`.
The airdrop act passes by itself when the wallet already holds enough, so a
funded learner presses nothing, and a later one is never shown to them. The definition check SHALL refuse a deploy act
with no airdrop act since the last deploy act, naming that act's id: the
first deploy as "an airdrop act before the first deploy", a later one as "an
airdrop act since the last deploy".

#### Scenario: Hello Anchor funds before it deploys (manual)
- **WHEN** the definition check reads Hello Anchor
- **THEN** the act `s2.airdrop` comes before the act `s2.deploy`, the act
  `s4.airdrop` comes before the act `s4.ship`, and the check passes

#### Scenario: A deploy with no airdrop before it (manual)
- **WHEN** a lesson's first deploy act `s2.deploy` has no airdrop act before it
- **THEN** the check fails with an error that names `s2.deploy`

#### Scenario: A later deploy with no airdrop since the last one (manual)
- **WHEN** a lesson funds and deploys in step 2, and its step 4 act `s4.ship`
  builds and deploys with no airdrop act between them
- **THEN** the check fails with an error, "an airdrop act since the last
  deploy", that names `s4.ship`

#### Scenario: A deploy in a planned failure counts after the step's beats (manual)
- **WHEN** a step's own beats end with an airdrop and a deploy, and its
  `onFail` holds another deploy act with no airdrop before it
- **THEN** the check fails with an error that names the `onFail` deploy act

#### Scenario: An airdrop act names an instruction (manual)
- **WHEN** an airdrop act carries `call`
- **THEN** the check fails, as it does for every act other than `call`

### Requirement: A call goal can name the account it creates

A `call` goal MAY carry `creates`, the IDL name of the account its instruction creates with Anchor's `init`. A goal with `creates` SHALL have a win with `existsLine`, the explanation shown when the account already exists, and a win SHALL carry `existsLine` only then. `checkDefinition` SHALL refuse a `creates` that the step's shipped IDL does not list among the instruction's accounts.

#### Scenario: Lumberjack's step 2 as a definition (manual)

- **WHEN** step 2's goal is `{ "kind": "call", "instruction": "init_player", "creates": "player" }` and its win has `existsLine`
- **THEN** the check passes

#### Scenario: creates without an existsLine (manual)

- **WHEN** a goal has `creates` and its win has no `existsLine`
- **THEN** the check names the win's missing `existsLine`

#### Scenario: An existsLine without creates (manual)

- **WHEN** a win has `existsLine` and its goal has no `creates`
- **THEN** the check refuses the `existsLine`

#### Scenario: An account the IDL does not list (manual)

- **WHEN** a goal's `creates` names an account the step's IDL does not list for the instruction
- **THEN** the check refuses the `creates`
