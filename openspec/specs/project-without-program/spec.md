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
this change, and one that holds Rust or Python no framework recognises SHALL
be refused as before, never imported without its program.

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
- **WHEN** the user imports a repository with `onchain/src/lib.rs`, which
  no framework recognises, and `client.ts`
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
under `client/`. Each keeps its path with that leading folder (or
`client/`) dropped. When two files want one place, a top-level file takes
it before one from `client/` or `tests/`, which takes it before one from
`test/`, whatever their order; the other keeps its whole path. Files of
other kinds SHALL be left out.

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

#### Scenario: A test file outside a tests folder
- **WHEN** a repository with no program holds `lib/math.spec.ts`
- **THEN** the project holds `tests/lib/math.spec.ts`

### Requirement: A project with no program shows only the Write stage

A project SHALL count as having no program when its `src/` folder holds
no Rust (`.rs`) or Python (`.py`) file. For such a project the dev-loop
stepper SHALL show only the Write stage: the Build, Deploy and Interact
tabs (`flow-stage-tab-build`, `flow-stage-tab-deploy`,
`flow-stage-tab-interact`) SHALL not be rendered, and their keyboard
shortcuts SHALL do nothing. The stepper row SHALL stay in place and SHALL
carry the label "Client project" (`flow-client-project`). The
check SHALL follow the files, so the stages return as soon as a program
file is added and leave when the last one is removed.

#### Scenario: An imported TypeScript project
- **WHEN** the user opens a project that holds only `client/` and
  `tests/` files
- **THEN** the stepper shows the Write tab and no Build, Deploy or
  Interact tab, the row shows the label "Client project", and Ctrl+2
  leaves the Write stage shown

#### Scenario: A program is added
- **WHEN** the user creates `src/lib.rs` in a project with no program
- **THEN** the Build, Deploy and Interact tabs appear and the "Client
  project" label goes

#### Scenario: A project with a program
- **WHEN** the user opens a project whose `src/` holds `lib.rs`
- **THEN** the stepper shows Write, Build, Deploy and Interact as before
