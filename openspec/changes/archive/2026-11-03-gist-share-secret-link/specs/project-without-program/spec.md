# Spec Delta

## MODIFIED Requirements

### Requirement: A project with no program shows only the Write stage

A project SHALL count as having no program when its `src/` folder holds
no Rust (`.rs`) or Python (`.py`) file. For such a project the dev-loop
stepper SHALL show only the Write stage: the Build, Deploy and Interact
tabs (`flow-stage-tab-build`, `flow-stage-tab-deploy`,
`flow-stage-tab-interact`) SHALL not be rendered, and their keyboard
shortcuts SHALL do nothing. The stepper row SHALL stay in place and SHALL
carry the label "Client project" (`flow-client-project`). On a phone, where
the stepper never shows Write, no stepper (`role="tablist"` named
"Development loop") SHALL be rendered for such a project, and the label
SHALL still show. The check SHALL follow the files, so the stages return as
soon as a program file is added and leave when the last one is removed.

#### Scenario: An imported TypeScript project
- **WHEN** the user opens a project that holds only `client/` and
  `tests/` files
- **THEN** the stepper shows the Write tab and no Build, Deploy or
  Interact tab, the row shows the label "Client project", and Ctrl+2
  leaves the Write stage shown

#### Scenario: A project with no program on a phone
- **WHEN** a project with no program is open below the phone breakpoint
- **THEN** no "Development loop" tablist is rendered, and the label "Client
  project" shows

#### Scenario: A program is added
- **WHEN** the user creates `src/lib.rs` in a project with no program
- **THEN** the Build, Deploy and Interact tabs appear and the "Client
  project" label goes

#### Scenario: A project with a program
- **WHEN** the user opens a project whose `src/` holds `lib.rs`
- **THEN** the stepper shows Write, Build, Deploy and Interact as before
