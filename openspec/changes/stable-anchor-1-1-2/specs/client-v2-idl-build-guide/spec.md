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
`anchor-spl` versions SHALL be the ones the stable build server compiles against.

#### Scenario: Export of the default starter (manual)

- **WHEN** a user exports the default Anchor starter and runs `anchor idl build` in it with Anchor 1.1.2
- **THEN** the command writes the IDL JSON and exits 0

#### Scenario: A program that uses anchor-spl (manual)

- **WHEN** the exported files include a program whose source contains `anchor_spl::`
- **THEN** the program's `Cargo.toml` has `idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]`

### Requirement: The Flow offers the guide where it offers the IDL

The Flow's Build, Deploy, and Interact stages SHALL show a button with the text and `aria-label`
"Build the IDL locally" beside each "Upload IDL" or "Download IDL" action. The button SHALL open a dialog titled
"Build the IDL on your machine". Interact's `no-idl` surface SHALL say that the build does not produce an IDL.

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

The dialog SHALL hold a two-option control with the `aria-label` "IDL build method", with the options "Docker" and
"Local toolchain", "Docker" selected when the dialog opens. Each method SHALL list numbered steps, from downloading
the project to uploading the IDL. Every shell command SHALL sit in a code block with a copy button whose
`aria-label` is "Copy command".

#### Scenario: Switching method (manual)

- **WHEN** the user selects "Local toolchain"
- **THEN** the steps for installing Rust, the Solana CLI, and Anchor through `avm` replace the Docker steps

#### Scenario: The last step (manual)

- **WHEN** either method is shown
- **THEN** its last step names the IDL file's path and holds an "Upload IDL" link

#### Scenario: Following Upload IDL (manual)

- **WHEN** the user presses the last step's "Upload IDL" from Build, Deploy, or Interact
- **THEN** the dialog closes, the Flow shows Deploy, and Deploy's "Upload IDL" takes focus and opens the file picker

#### Scenario: Docker's install page (manual)

- **WHEN** the Docker method is shown
- **THEN** "Docker" in its build step links to `https://docs.docker.com/get-started/get-docker/`

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
`docker-build`, `install-rust`, `install-solana`, `install-anchor`, `anchor-build`; and
`idl_guide_upload_followed`, with no parameters, when the user presses the last step's "Upload IDL".

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
