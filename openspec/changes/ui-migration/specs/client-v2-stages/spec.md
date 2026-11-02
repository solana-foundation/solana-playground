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
compiler's label, and SHALL offer Explain and Fix on it, each sending the
error to the assistant. The stage keeps `flow-stage-panel-build`.

#### Scenario: A failed build marks the faulty line

- **WHEN** a build fails with a type error in `src/lib.rs` line 5
- **THEN** the stage shows one diagnostic with the code E0308
- **AND** line 5 is marked as the faulty one, with "expected u32, found &str"
  beside it
- **AND** Explain and Fix are offered on it

### Requirement: Build refuses an empty program file

When `src/lib.rs` exists and holds nothing but whitespace, Build SHALL send no
build request, SHALL name the file as empty with "Write a program, or ask the
assistant for one.", and SHALL count the attempt as a failed build, so Deploy
does not go on with the binary of the program the file used to hold. A
project without `src/lib.rs` builds as before.

#### Scenario: Building an empty lib.rs (manual)

- **WHEN** a user empties `src/lib.rs` in a project that built before and
  presses Build
- **THEN** no request reaches the build server, the terminal and the Build
  stage say "lib.rs is empty. Write a program, or ask the assistant for one."
- **AND** Deploy then warns "Your last build failed" and asks before it
  uploads the earlier binary

### Requirement: A slow build says so

While a build runs, the Build stage SHALL keep a polite status region, and
SHALL put "This build is taking longer than usual." in it once the run has
lasted 60 seconds, counted from the run's own start so a remount does not
restart the clock. The line is never in a warning colour.

#### Scenario: A build past 60 seconds (manual)

- **WHEN** a build has run for more than 60 seconds, the Build stage
  remounting once on the way
- **THEN** the stage shows "This build is taking longer than usual." in muted
  text under the build's progress, and a screen reader announces it once
- **AND** the line is gone when the build ends

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
