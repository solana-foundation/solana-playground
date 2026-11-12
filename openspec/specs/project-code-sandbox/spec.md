# project-code-sandbox Specification

## Purpose
Where `run` and `test` execute project code, what that code can reach, and
what it is given, so a script from a shared project cannot read the page's
data or the built-in wallet's key, and still runs as it did before.

## Requirements

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
A standard wallet under `pg.wallets`, and `pg.wallet` when it is the current
one, SHALL expose its name, its public key, `signTransaction`,
`signAllTransactions` and `signMessage` only, since only those cross into the
sandbox.

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

#### Scenario: A callback the code does not await still gets its reply

- **WHEN** project code starts an RPC call it does not await, such as
  `pg.connection.getBalance(...).then(console.log)`, and the run ends first
- **THEN** the reply still reaches the callback, and what it prints shows in
  the terminal, until the next run replaces the sandbox

#### Scenario: An error after the run ended says so

- **WHEN** a callback the code did not await throws after the run ended
- **THEN** the terminal prints "Uncaught error after the run ended:" with its
  message, and the run's result stays as it was

#### Scenario: A refused IDL says why where the program would be

- **WHEN** the project's IDL is refused (`readIdl`) and project code reads
  `pg.program` or the program's name under `anchor.workspace`
- **THEN** the read throws "The program's IDL can't be called: <reason>.",
  and `pg.program` is not among `pg`'s keys

#### Scenario: A run's code never reaches the next run

- **WHEN** a run's code keeps announcing itself as a fresh runtime and
  answers any port it is handed, and the next run starts
- **THEN** the next run's code runs in a new frame and nothing the earlier
  run's code posts reaches the terminal

#### Scenario: A failing test is reported

- **WHEN** `test` runs a file with one passing and one failing test
- **THEN** the terminal shows "1 passing" and "1 failing", and the command
  ends

#### Scenario: A syntax error ends the run

- **WHEN** `run` executes a file with a syntax error
- **THEN** the terminal prints the error, and the command ends instead of
  hanging

#### Scenario: An error thrown in a callback the code awaits ends the run

- **WHEN** `run` executes a file that awaits a promise whose timer callback
  throws
- **THEN** the terminal prints "Uncaught error:", and the command ends
  instead of hanging

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
