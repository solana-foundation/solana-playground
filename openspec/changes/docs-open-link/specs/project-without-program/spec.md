## MODIFIED Requirements

### Requirement: A project with no program shows only the Write stage

A project SHALL count as having no program when its `src/` folder holds
no Rust (`.rs`) or Python (`.py`) file. For such a project the dev-loop
stepper SHALL show only the Write stage: the Build, Deploy and Interact
tabs (`flow-stage-tab-build`, `flow-stage-tab-deploy`,
`flow-stage-tab-interact`) SHALL not be rendered, and their keyboard
shortcuts SHALL do nothing. The stepper row SHALL stay in place and SHALL
carry the label "Client project" (`flow-client-project`) and the Run button
(`flow-run`, see `client-run`). On a phone, where the stepper never shows
Write, no stepper (`role="tablist"` named "Development loop") SHALL be
rendered for such a project, and the label and Run SHALL still show. The
check SHALL follow the files, so the stages return as soon as a program file
is added and leave when the last one is removed.

On a phone, the "Preview the build" button SHALL bring such a project's
Preview page (the region named "Preview") into view and keep it there while
the stage stays Write, with the label "Client project" and the console in
the viewport; entering that page SHALL open the console, and the open
console SHALL take the page below the bar. Before
anything has run, the console strip SHALL read "Run the client to see its
output here." A client run (the `run` command) in such a project SHALL open
the console at every width, and on a phone SHALL also bring the Preview page
into view.

The terminal's welcome SHALL name what such a project has: "Output from
your client and your commands shows here." in place of "Output from Build,
Deploy and your commands shows here.", followed by the line naming `help`.
The welcome SHALL follow whether the project has a program: when that answer
arrives or a project switch changes it, the welcome SHALL be reprinted with
the right wording until something is printed to the terminal, and SHALL be
left alone after that.

#### Scenario: An imported TypeScript project
- **WHEN** the user opens a project that holds only `client/` and
  `tests/` files
- **THEN** the stepper shows the Write tab and no Build, Deploy or
  Interact tab, the row shows the label "Client project" and Run, and
  Ctrl+2 leaves the Write stage shown

#### Scenario: A project with no program on a phone
- **WHEN** a project with no program is open below the phone breakpoint
- **THEN** no "Development loop" tablist is rendered, and the label "Client
  project" and Run show

#### Scenario: The preview of a project with no program on a phone
- **WHEN** a project with no program is open at 390x844 and the user taps
  "Preview the build"
- **THEN** the Preview page is in the viewport and stays, the label "Client
  project" and the console strip reading "Run the client to see its output
  here." are in the viewport, and the Work page is not

#### Scenario: Entering the Preview opens the console (manual)
- **WHEN** a project with no program is open at 390x844 with the console
  folded and the user taps "Preview the build"
- **THEN** the console is open, reported by `layout_panel_toggled` with
  `via: "auto"`

#### Scenario: The terminal's welcome in a project with no program (manual)
- **WHEN** a project with no program is open and nothing has been printed to
  the terminal
- **THEN** the terminal reads "Output from your client and your commands
  shows here." and no line names Build or Deploy

#### Scenario: The welcome follows the program answer (manual)
- **WHEN** nothing has been printed to the terminal and the user switches
  between a project with a program and one with none
- **THEN** the terminal holds only the welcome worded for the open project

#### Scenario: The welcome is left alone after output (manual)
- **WHEN** something has been printed to the terminal and the user switches
  between a project with a program and one with none
- **THEN** the printed text stays and the welcome is not reprinted

#### Scenario: A program is added
- **WHEN** the user creates `src/lib.rs` in a project with no program
- **THEN** the Build, Deploy and Interact tabs appear, and the "Client
  project" label and Run go

#### Scenario: A project with a program
- **WHEN** the user opens a project whose `src/` holds `lib.rs`
- **THEN** the stepper shows Write, Build, Deploy and Interact as before
