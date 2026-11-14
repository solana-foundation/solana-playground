# project-without-program Specification

## Purpose

Lets a user bring TypeScript work with no Solana program into the
Playground, and keeps the dev loop from offering stages such a project
cannot use.

## Requirements

### Requirement: A repository with no program imports as a TypeScript project

Import from GitHub and from local files SHALL accept a repository, or a
folder of one, in which no supported framework finds a program, which holds
TypeScript or JavaScript files (`ts`, `tsx`, `js`, `jsx`) and no Rust or
Python file. It SHALL be imported as a project with no program. A
repository in which a framework finds a program SHALL be imported as before
this change. Files no framework recognises, whose program source is all Rust
under `src/`, with no Python and no `Cargo.toml` or `Xargo.toml` at the root
(the layout Export writes for a Rust project), SHALL be
imported as they are, with their paths below the imported folder unchanged,
whether they come from the zip Settings › Import reads, a dropped folder or a
GitHub repository, so an exported project returns as it left. Any other repository that holds
Rust or Python no framework recognises SHALL be refused as before, never
imported without its program.

#### Scenario: A Playground project whose program has no framework marker yet (manual)

- **WHEN** the user imports the zip Export wrote for a project holding
  `src/lib.rs` with only `// Import anchor`, and `client/client.ts`
- **THEN** a project is created holding the same files

#### Scenario: A plain Rust crate (manual)

- **WHEN** the user imports a repository with `Cargo.toml` and
  `src/main.rs`, which no framework recognises
- **THEN** the import fails with "This doesn't look like a Solana
  program. Playground opens Anchor, native Rust and Seahorse programs.",
  and nothing is imported

#### Scenario: A client and its tests

- **WHEN** the user imports a repository that holds `index.ts`,
  `lib/rpc.ts` and `tests/rpc.test.ts` and no program
- **THEN** a project is created and opened, holding
  `client/index.ts`, `client/lib/rpc.ts` and `tests/rpc.test.ts`

#### Scenario: A repository with an Anchor program

- **WHEN** the user imports a repository with `programs/<name>/src/lib.rs`
  and a TypeScript client
- **THEN** the project is laid out exactly as an Anchor repository was
  before this change

#### Scenario: A program no framework recognises

- **WHEN** the user imports a repository with `onchain/src/lib.rs` (not
  under a leading `src/`), which no framework recognises, and `client.ts`
- **THEN** the import fails with "This doesn't look like a Solana
  program. Playground opens Anchor, native Rust and Seahorse programs.",
  and nothing is imported

#### Scenario: A repository with neither

- **WHEN** the user imports a repository that holds no program and no
  TypeScript or JavaScript file
- **THEN** the import fails with "No program code found in
  {owner}/{repo}." (or "{folder} in {owner}/{repo}" for a folder of it)

### Requirement: Place a no-program repository's files by kind

In a repository imported with no program, paths SHALL be read from the
imported folder. A test file (`*.test.*` or `*.spec.*` of `ts`, `tsx`, `js`,
`jsx`) or any TypeScript or JavaScript file in a leading `tests/` or `test/`
folder SHALL go under `tests/`; every other TypeScript or JavaScript file
under `client/`. A JSON file (`.json`) SHALL be placed by the same rule,
under `tests/` when it sits in a leading `tests/` or `test/` folder and
under `client/` otherwise, so a script's relative import of an IDL or a
fixture within the same folder still resolves. Each keeps its path with that leading folder (or
`client/`) dropped. When two files want one place, a top-level file takes
it before one from `client/` or `tests/`, which takes it before one from
`test/`, whatever their order; the other keeps its whole path. A JSON
file that is tool configuration (`package.json`, `package-lock.json`,
`npm-shrinkwrap.json`,
`tsconfig*.json`, `jsconfig*.json`, or one whose name or folder starts with
a dot) and files of other kinds SHALL be left out. JSON alone SHALL count
as nothing to open. A relative import that crosses from `client/` to
`tests/` (including a loose test file's import of JSON beside it), or out
of a leading folder the placement drops, is not rewritten.

#### Scenario: Folders are kept

- **WHEN** a repository with no program holds `src/app/main.ts`,
  `test/unit/math.ts`, `client/run.ts`, `README.md` and `package.json`
- **THEN** the project holds `client/src/app/main.ts`,
  `tests/unit/math.ts` and `client/run.ts`, and nothing else

#### Scenario: A folder of a repository

- **WHEN** the user imports `github.com/<owner>/<repo>/tree/main/token/client`,
  holding `index.ts` and `tests/a.ts`
- **THEN** the project holds `client/index.ts` and `tests/a.ts`

#### Scenario: Two files for one place

- **WHEN** a repository with no program holds `a.ts` and `client/a.ts`
- **THEN** the project holds both, as `client/a.ts` and `client/client/a.ts`

#### Scenario: An IDL and a fixture are kept

- **WHEN** a repository with no program holds `src/index.ts` importing
  `../idl/x.json`, `idl/x.json`, `tests/a.test.ts` importing
  `./fixtures/a.json`, `tests/fixtures/a.json` and `tsconfig.json`
- **THEN** the project holds `client/src/index.ts`, `client/idl/x.json`,
  `tests/a.test.ts` and `tests/fixtures/a.json`, and no `tsconfig.json`

#### Scenario: A test file outside a tests folder

- **WHEN** a repository with no program holds `lib/math.spec.ts`
- **THEN** the project holds `tests/lib/math.spec.ts`

### Requirement: A project with no program shows only the Write stage

A project SHALL count as having no program when its `src/` folder holds
no Rust (`.rs`) or Python (`.py`) file. Such a project SHALL offer only the
Write stage: no dev-loop stepper (`role="tablist"` named "Development loop")
SHALL be rendered for it at any width, since a stepper of one tab reads as
broken, and the Build, Deploy and Interact keyboard shortcuts SHALL do
nothing. The stepper's row SHALL stay in place and SHALL carry the label
"Client project" (`flow-client-project`) and Run (`flow-run`). Above the phone
breakpoint the row SHALL also name the cluster the project runs on
(`flow-client-cluster`) and carry Add program (`flow-add-program`), which
creates `src/lib.rs`, and Test (`flow-test`), which runs the `test` command;
the file tree there SHALL draw no section actions of its own (no Run, Test or
add-program button), the row owning them. On a phone the row SHALL keep the label and Run, and the Files sheet SHALL
keep the tree's Run and Test, and its add-program button when the project has
no `src` folder. The check SHALL follow the files, so the stages return as soon as a
program file is added and leave when the last one is removed.

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
- **THEN** no "Development loop" tablist is rendered, the row shows the
  label "Client project", the cluster, Add program, Test and Run, the file
  tree shows no Run or Test button, and Ctrl+2 leaves the Write stage shown

#### Scenario: A project with no program on a phone

- **WHEN** a project with no program is open below the phone breakpoint
- **THEN** no "Development loop" tablist is rendered, and the label "Client
  project" shows

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

- **WHEN** the user presses Add program in a project with no program
- **THEN** `src/lib.rs` is created, the Write, Build, Deploy and Interact
  tabs appear, the "Client project" label and Run go, and
  `client_project_program_added` is sent

#### Scenario: A project with a program

- **WHEN** the user opens a project whose `src/` holds `lib.rs`
- **THEN** the stepper shows Write, Build, Deploy and Interact as before

### Requirement: Kbd hides under a coarse pointer

The design system's key hint (`Kbd`) SHALL not be displayed when the
primary pointer is coarse (`pointer: coarse`), wherever it is used: a touch
screen has no keys to press, and the hint takes room on a narrow strip.
Where a fine pointer is primary, the hint SHALL show as before. Menu shortcuts
(`DropdownMenuShortcut`) are not `Kbd` and this requirement does not cover them.

#### Scenario: The console strip on a phone (manual)

- **WHEN** the console strip is shown on a device whose primary pointer is
  coarse
- **THEN** no key hint is displayed beside it

#### Scenario: A desktop with a mouse (manual)

- **WHEN** the same strip is shown with a fine primary pointer
- **THEN** its key hint is displayed
