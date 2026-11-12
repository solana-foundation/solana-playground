# client-v2-stages Specification

## Purpose

What the Deploy and Interact stages show and offer, in each state.

## Requirements

### Requirement: An Interact instruction card groups its inputs

Each instruction card on the Interact stage SHALL show, beside the
instruction's name, how many inputs it takes as "n args · n accounts"
(singular for one, a kind with none left out, nothing for an instruction that
takes none). The card itself folds; once open, its inputs SHALL sit under two
fixed headings, "Arguments" and "Accounts", each shown only when the
instruction has inputs of that kind, never folded on their own. An input's label SHALL be its name, then its type in quiet
mono, then `mut` and `signer` as neutral tags with no colour of their own.

#### Scenario: An instruction with one argument and two accounts

- **WHEN** the Interact stage shows an instruction with one argument and two
  accounts
- **THEN** its card's head reads "1 arg · 2 accounts"
- **AND** once the card is opened, the argument sits under "Arguments" and the
  accounts under "Accounts", with no further click

#### Scenario: An instruction that takes nothing

- **WHEN** the Interact stage shows an instruction with no arguments and no
  accounts
- **THEN** its card's head shows no count and neither heading is drawn

### Requirement: An Interact card's Send says what it waits for

An instruction card SHALL end in one row with Send, the card's only primary
action, and, for an instruction that has inputs, "Fill with Random" and
"Reset" beside it as quiet buttons. While Send is held, the row SHALL say why:
"Connect a wallet to send" with no wallet, else "Fill every field to send"
until the fields have been checked and every one holds a valid value; nothing
once Send can run.

#### Scenario: Send held for a wallet (manual)

- **WHEN** no wallet is connected and the user opens an instruction card
- **THEN** Send is disabled and the row reads "Connect a wallet to send"

#### Scenario: Send held for a field (manual)

- **WHEN** a wallet is connected and an argument of the instruction is empty
- **THEN** Send is disabled and the row reads "Fill every field to send"

### Requirement: Copy sits inside an Interact field

An Interact input that holds a value SHALL offer its Copy button
(`data-slot="copy-button"`) inside the field, at its end, and none while the
field is empty.

#### Scenario: Copy appears with a value

- **WHEN** the user types a value into an Interact argument
- **THEN** a Copy button shows inside that field and copies the value

### Requirement: The Deploy stage names its cluster and what holds it

Once the selected cluster is known, the Deploy stage SHALL show it over its
title, capitalised ("Devnet"), with a status dot, before and after the first
deploy; until then no cluster line is drawn. Until a build has succeeded, its
description SHALL read "Build the program first." and its pill SHALL be "Go to
Build" in place of Deploy. A failed deploy SHALL show an error callout
(`role="alert"`) reading "Could not deploy. The full log has the details." Upload
IDL SHALL be an outlined button in the pill's height and shape: beside the pill
on a desk, above it on a phone. The stage keeps `flow-stage-panel-deploy`.

#### Scenario: Deploy before a build

- **WHEN** a project that has never been built opens the Deploy stage on devnet
- **THEN** the stage shows "Devnet" over "Nothing deployed yet"
- **AND** reads "Build the program first."
- **AND** the pill is Go to Build, with Upload IDL an outlined button beside it

#### Scenario: A failed deploy

- **WHEN** a deploy fails
- **THEN** the stage shows "Could not deploy. The full log has the details."
  in an alert

### Requirement: A stage's buttons hold still while their action runs

While a Build, Deploy or Interact stage's action runs, no button in that
stage SHALL move sideways: a button whose label changes while it waits SHALL
be as wide busy as idle, and the stage SHALL keep the room of its scrollbar
whether or not its content overflows. One exception stands until HOO-2796
settles the Deploy stage's action row: the Deploy pill alone in that row may
change its width between its idle label ("Deploy to <cluster>", "Redeploy
to <cluster>") and its busy one ("Deploying...", "Upgrading..."), keeping
its centre. The first Build pill ("Build", with its play mark) is not
held: the first build replaces it with the run's progress bar and Stop, so
it is not on screen while the build runs. The busy button's accessible name SHALL
be the label it shows ("Building…", "Sending…"), and it SHALL carry
`aria-busy="true"` while it waits.

#### Scenario: Build again keeps the action row in place

- **WHEN** a build has succeeded, the code has not changed since, and the
  user presses the outline "Build again" beside "Continue to Deploy"
- **THEN** "Build again" reads "Building…" until the build ends
- **AND** neither "Build again" nor "Continue to Deploy" moves sideways in any
  frame while it runs

#### Scenario: Send keeps the card's row in place

- **WHEN** a wallet is connected and the user presses Send on an instruction
  card with inputs
- **THEN** Send reads "Sending…" until the call settles
- **AND** neither Send nor "Fill with Random" nor "Reset" moves sideways in
  any frame while it runs

#### Scenario: A deploy that outgrows the stage (manual)

- **WHEN** a deploy runs in a window short enough for the Deploy stage to
  overflow, in a browser that shows classic scrollbars
- **THEN** the stage's content does not move sideways when the scrollbar
  appears
