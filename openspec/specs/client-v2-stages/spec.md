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

### Requirement: An Interact card's Test says what it waits for

An instruction card SHALL end in one row with Test, the card's only primary
action, and, for an instruction that has inputs, "Fill with Random" and
"Reset" beside it as quiet buttons. While Test is held, the row SHALL say why:
"Connect a wallet to test" with no wallet, else "Fill every field to test"
until the fields have been checked and every one holds a valid value; nothing
once Test can run.

#### Scenario: Test held for a wallet

- **WHEN** no wallet is connected and the user opens an instruction card
- **THEN** Test is disabled and the row reads "Connect a wallet to test"

#### Scenario: Test held for a field

- **WHEN** a wallet is connected and an argument of the instruction is empty
- **THEN** Test is disabled and the row reads "Fill every field to test"

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
