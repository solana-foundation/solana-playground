# Spec Delta

## Purpose

How `client-v2` gets a user from a build without an IDL to an uploaded IDL: the guide to building the IDL on the
user's machine, the exported project it relies on, and keeping an uploaded IDL across builds.

## ADDED Requirements

### Requirement: A build without an IDL keeps the IDL the browser holds

When a build response carries `idl: null`, `client-v2` SHALL keep the IDL it already holds for the program. A
response with an IDL SHALL replace it.

#### Scenario: Rebuild after an upload (manual)

- **WHEN** a user uploads an IDL, then builds, and the build response carries `idl: null`
- **THEN** Interact still offers the uploaded IDL's instructions

#### Scenario: A build that returns an IDL (manual)

- **WHEN** the held IDL names program `a`, and a build response carries an IDL that names program `b`
- **THEN** the held IDL names program `b`

### Requirement: The Anchor export can build its own IDL

The Anchor project export SHALL write an `idl-build` feature into the program's `Cargo.toml`. The feature SHALL list
`anchor-lang/idl-build`, and `anchor-spl/idl-build` when the program imports `anchor_spl`. The `anchor-lang` and
`anchor-spl` versions SHALL be the ones the stable build server compiles against. The export SHALL ship the build
server's `Cargo.lock` and SHALL write each dependency with the features the build server's manifest declares on that
crate, so the local build resolves the crate versions and features the server builds with.

#### Scenario: A program that uses spl-token-2022 (manual)

- **WHEN** a user exports a program whose source uses `spl_token_2022::` and runs the guide's Docker command in it
- **THEN** the program's `Cargo.toml` has `spl-token-2022 = { version = "=10.0.0", features = ["no-entrypoint"] }`,
  the project root has the server's `Cargo.lock`, and the command writes `idl.json` and exits 0

#### Scenario: Export of the default starter (manual)

- **WHEN** a user exports the default Anchor starter and runs `anchor idl build` in it with Anchor 1.1.2
- **THEN** the command writes the IDL JSON and exits 0

#### Scenario: A program that uses anchor-spl (manual)

- **WHEN** the exported files include a program whose source contains `anchor_spl::`
- **THEN** the program's `Cargo.toml` has `idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]`

### Requirement: The Flow offers the guide where it offers the IDL

The Flow's Build, Deploy, and Interact stages SHALL show a button with the text and `aria-label`
"Build the IDL locally" beside each "Upload IDL" or "Download IDL" action. The button SHALL open a dialog titled
"Build the IDL on your machine". For a Native project, the button SHALL show disabled, with a "Coming soon" tooltip,
and SHALL open no dialog; a project whose framework cannot be told keeps the button enabled. Interact's `no-idl`
surface SHALL say that the build does not produce an IDL.

#### Scenario: A Native project (manual)

- **WHEN** the open project is a Native project
- **THEN** "Build the IDL locally" shows disabled, and hovering it shows "Coming soon"

#### Scenario: Interact without an IDL

- **WHEN** a program is deployed and the browser holds no IDL for it
- **THEN** Interact's empty surface shows "Build the IDL locally" and "Upload IDL"

#### Scenario: Opening the guide

- **WHEN** the user presses "Build the IDL locally" on any of the three stages
- **THEN** a dialog titled "Build the IDL on your machine" opens

### Requirement: The Build stage does not claim an IDL it lacks

After a successful build, the Build stage SHALL say that the build produces no IDL and SHALL offer
"Build the IDL locally"; it SHALL NOT say that an IDL reflects the build. While the browser holds no IDL, the Build
stage SHALL NOT show "Download IDL", and "Build the IDL locally" SHALL take its place in the downloads row.

#### Scenario: A successful build (manual)

- **WHEN** a build succeeds and its response carries `idl: null`
- **THEN** the Build stage's message does not contain "The IDL below reflects this build", and "Build the IDL
  locally" is shown

#### Scenario: Download without an IDL (manual)

- **WHEN** a build succeeds and the browser holds no IDL
- **THEN** the Build stage shows no "Download IDL", and "Build the IDL locally" is first in its downloads row

### Requirement: The guide offers a Docker method and a local method

The dialog SHALL hold a radio group with the `aria-label` "IDL build method", with two cards that both stay in view:
"Docker" ("Only Docker needed") and "Local toolchain" ("Rust, Solana CLI, Anchor"), "Docker" selected when the
dialog opens. Each method SHALL list numbered steps, from downloading
the project to uploading the IDL, and a step SHALL be its number and its control, with no step title. Every shell
command SHALL sit in a code block without line numbers whose long lines wrap, with a copy button whose `aria-label`
is "Copy command" and which stays visible. The local method SHALL show its install of Rust, the Solana CLI and Anchor
as one open step that lists each tool under its own name with its own copy button.
Only the steps SHALL scroll: the title, the method control and the last step SHALL stay in view.

#### Scenario: Switching method (manual)

- **WHEN** the user selects "Local toolchain"
- **THEN** the step "Install Rust, Solana CLI, Anchor if missing" and the build command replace the Docker command

#### Scenario: The install is open (manual)

- **WHEN** the local method is shown
- **THEN** its install step lists Rust, the Solana CLI and Anchor through `avm`, each with its own "Copy command"

#### Scenario: The last step (manual)

- **WHEN** either method is shown, on a screen too short for every step
- **THEN** its last step is a drop zone "Drop idl.json or browse" at the dialog's foot, in view while the steps scroll

#### Scenario: Dropping the IDL (manual)

- **WHEN** the user drops or picks an Anchor IDL file on the last step
- **THEN** the browser holds that IDL, the foot says "IDL loaded", and its "Go to Interact" closes the dialog and the
  Flow shows Interact

#### Scenario: Dropping a file that is not an IDL (manual)

- **WHEN** the user drops a file that is not an Anchor IDL on the last step
- **THEN** the step says "That file is not an Anchor IDL." and the browser keeps the IDL it held

### Requirement: The guide's commands pin the server's versions

The Docker method SHALL run `anchor idl build` in the image `quay.io/ottersec/anchor:v<anchor version>`. The local
method SHALL install the Solana CLI version and the Anchor version the stable build server uses, Anchor through
`avm`. Both versions SHALL come from one declaration in `client-v2`, so a version bump edits one place.

#### Scenario: Docker command (manual)

- **WHEN** a user runs the Docker method's commands in an exported, unzipped Anchor project on a machine with Docker
- **THEN** the IDL JSON exists at the path the last step names

#### Scenario: Local toolchain (manual)

- **WHEN** a user on macOS or Linux without Rust runs the local method's commands in order in an exported project
- **THEN** the IDL JSON exists at the path the last step names

### Requirement: The guide downloads the project

The first step of both methods SHALL hold a "Download project" button that exports the open workspace in Anchor's
layout as a zip. A failed export SHALL show its reason in the dialog and log it.

#### Scenario: Download (manual)

- **WHEN** the user presses "Download project" in an Anchor workspace
- **THEN** the browser saves `<workspace>.zip`

#### Scenario: A workspace whose framework cannot be told (manual)

- **WHEN** the export throws because the framework cannot be told
- **THEN** the dialog shows the reason under the button, and the dialog stays open

### Requirement: The guide reports how it is used

The slice `idl-build-guide` SHALL send `idl_guide_opened` when the dialog opens, with `surface` one of `build`,
`deploy`, `interact`; `idl_guide_method_picked` when the user changes the method, not on open, with `method`
`docker` or `local`; and `idl_guide_command_copied` when a copy succeeds, with `method` and `step` one of
`docker-build`, `install-rust`, `install-solana`, `install-anchor`, `anchor-build`; and, with no parameters,
`idl_guide_idl_loaded` when a file dropped or picked on the last step is loaded as the IDL, and
`idl_guide_idl_refused` when that file is not an Anchor IDL.

#### Scenario: Open, switch, copy (manual)

- **WHEN** the user opens the guide from Interact, selects "Local toolchain", and copies the Rust install command
- **THEN** the memory provider records `idl_guide_opened` with `surface: "interact"`, `idl_guide_method_picked`
  with `method: "local"`, and `idl_guide_command_copied` with `method: "local"` and `step: "install-rust"`, in
  that order

### Requirement: The guide reports the project download

The slice `idl-build-guide` SHALL send `idl_guide_project_downloaded`, with no parameters, when the zip is saved,
and `idl_guide_export_failed` when the export throws, with `reason` one of `unknown-framework`, `no-workspace`,
`other`.

#### Scenario: A saved zip (manual)

- **WHEN** the user presses "Download project" and the export succeeds
- **THEN** the memory provider records `idl_guide_project_downloaded`

#### Scenario: A failed export (manual)

- **WHEN** the export throws because the framework cannot be told
- **THEN** the memory provider records `idl_guide_export_failed` with `reason: "unknown-framework"`, and no
  `idl_guide_project_downloaded`
