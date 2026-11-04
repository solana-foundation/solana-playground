# Spec Delta

## Purpose

Where `run` and `test` execute project code, what that code can reach, and
what it is given, so a script from a shared project cannot read the page's
data or the built-in wallet's key, and still runs as it did before.

## ADDED Requirements

### Requirement: Project code runs in an opaque-origin sandbox

`run` and `test` SHALL execute project code in an iframe sandboxed to
scripts only, with an opaque origin: no same-origin access, no top-level
navigation, no popups and no forms. The page SHALL talk to it only over a
private message channel set up before any project code runs, and SHALL
ignore every other message.

#### Scenario: A sandboxed script cannot read the page's storage

- **WHEN** a script reads `localStorage`, `sessionStorage`, `indexedDB` or
  `document.cookie`
- **THEN** each read throws or comes back empty, and the script never sees
  the wallet's accounts or the IndexedDB wallet database

#### Scenario: A sandboxed script cannot reach the page

- **WHEN** a script reads `window.parent.document`, `window.top.localStorage`
  or `parent.PgWallet` (written to get past the keyword filter)
- **THEN** each access throws a cross-origin error

#### Scenario: A sandboxed script cannot find the key on pg

- **WHEN** a script walks every property of `pg`, `pg.wallet`,
  `pg.wallet.keypair` and their prototypes, and prints what it finds
- **THEN** no value holds the current account's private key bytes

#### Scenario: Messages from elsewhere are ignored

- **WHEN** another window posts a sign request to the page while a script
  runs
- **THEN** the page signs nothing and the script's run is unaffected

### Requirement: Project code gets the same globals as before

In the sandbox, project code SHALL get `pg` (`connection`, `wallet`,
`wallets`, `PROGRAM_ID`, `program`), `console`, `sleep`, the global packages
of `supported-packages.json` (`web3`, `anchor`, `BN`, `borsh`, `Buffer`,
`BufferLayout`, `assert`, `mocha`), imports of every importable package,
and the anchor IDL from `target/types`, as the in-page runtime gave them.

#### Scenario: The default client runs

- **WHEN** `run` executes the default client, which prints the wallet's
  address and balance
- **THEN** the terminal shows the current account's address and its balance

#### Scenario: Imports resolve inside the sandbox

- **WHEN** a script imports `@solana/spl-token` and `* as anchor from
  "@coral-xyz/anchor"`
- **THEN** both resolve, and the script runs

#### Scenario: Anchor workspace and program are ready

- **WHEN** an anchor project with a built IDL and a deployed program runs its
  test that uses `pg.program` and `anchor.workspace.<Name>`
- **THEN** both are the project's program on the current endpoint, and the
  test's instruction is sent

### Requirement: Output and results reach the terminal as before

`console.log`, `info`, `warn` and `error` in the sandbox SHALL print to the
terminal in the same styles. A test run SHALL print mocha's results, and
SHALL end when mocha finishes. An uncaught error or a syntax error SHALL
print its message and end the run.

#### Scenario: A failing test is reported

- **WHEN** `test` runs a file with one passing and one failing test
- **THEN** the terminal shows "1 passing" and "1 failing", and the command
  ends

#### Scenario: A syntax error ends the run

- **WHEN** `run` executes a file with a syntax error
- **THEN** the terminal prints the error, and the command ends instead of
  hanging

### Requirement: RPC from the sandbox goes through the page

Every RPC request a sandboxed script makes through `pg.connection`, or a
connection it builds with web3.js, SHALL be carried out by the page. The
result SHALL be the same as the page's own request to that endpoint,
Playnet included.

#### Scenario: A script runs against Playnet

- **WHEN** the endpoint is Playnet and a script gets its balance and sends a
  transfer
- **THEN** both succeed against the in-browser Playnet

### Requirement: The sandbox loads within a bounded time

If the sandbox has not reported ready within 15 seconds of `run` or `test`,
the command SHALL fail with an error saying that the runtime did not load,
and SHALL log the failure.

#### Scenario: The sandbox page fails to load (manual)

- **WHEN** the sandbox page's request is blocked and `run` is started
- **THEN** after 15 seconds the terminal says the runtime did not load, and
  the command ends
