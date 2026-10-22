# Spec Delta

## Purpose

What the Build, Deploy and Interact stages of the development loop show: a
failed build explained line by line, the latest deployment's program id, what
Interact still needs before it can call the program, and the stage's one
action within reach of the thumb on a phone.

## ADDED Requirements

### Requirement: The Build stage explains a failed build

The Build stage SHALL show each compiler error as a diagnostic
(`data-slot="diagnostic"`) with its error code, a plain explanation and the
source lines around it, the faulty line marked (`data-fault`) with the
compiler's label, and SHALL offer "Fix with assistant" on it. The stage keeps
`flow-stage-panel-build`.

#### Scenario: A failed build marks the faulty line

- **WHEN** a build fails with a type error in `src/lib.rs` line 5
- **THEN** the stage shows one diagnostic with the code E0308
- **AND** line 5 is marked as the faulty one, with "expected u32, found &str"
  beside it
- **AND** "Fix with assistant" is offered on it

### Requirement: The Deploy stage shows the latest deployment

After a deployment the Deploy stage SHALL show, in a `role="status"` block,
where it was deployed and the program id with a button that copies it
(`data-slot="copy-button"`). The stage keeps `flow-stage-panel-deploy`.

#### Scenario: A deployment shows its program id to copy

- **WHEN** the project has been deployed to devnet
- **THEN** the Deploy stage says "Deployed to devnet"
- **AND** shows the program id with a button that copies it

### Requirement: The Interact stage says what is missing

Until the program can be called, the Interact stage SHALL say in one empty
state (`data-slot="stage-empty"`) what is missing and offer the step that
supplies it: Go to Build before a build or without a program id, Go to Deploy
before a deployment,
Load IDL file for an imported program without an IDL. The stage keeps
`flow-stage-panel-interact`.

#### Scenario: Interact before a deploy

- **WHEN** a built project that has never been deployed opens the Interact
  stage
- **THEN** the stage says "Nothing to call yet"
- **AND** offers Go to Deploy, which switches to the Deploy stage

### Requirement: A stage's action sits at the foot on a phone

Below 768 px the action row of the Build, Deploy and Interact stages
(`data-slot="stage-empty-actions"`) SHALL sit at the foot of the stage,
whether the stage's content is shorter or taller than the screen.

#### Scenario: The Build action at the foot on a phone

- **WHEN** the Build stage is shown on a 390 px wide screen with nothing built
- **THEN** the Build button sits at the foot of the stage

#### Scenario: The Deploy action at the foot on a phone

- **WHEN** the Deploy stage of a deployed project is shown on a 390 px wide
  screen
- **THEN** the Redeploy button sits at the foot of the stage

#### Scenario: The Interact action at the foot on a phone

- **WHEN** the Interact stage of a project that has never been deployed is
  shown on a 390 px wide screen
- **THEN** the Go to Deploy button sits at the foot of the stage
