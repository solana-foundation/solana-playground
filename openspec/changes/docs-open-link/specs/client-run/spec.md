## ADDED Requirements

### Requirement: Run a client project from the stage row

A project with no program SHALL have a Run button (`flow-run`) in its stage
row. Pressing it SHALL:

- run the project's scripts under `client/`, as the terminal's `run` does,
  stopping at the first script that fails (the terminal's `test` still runs
  every test file);
- open the terminal;
- print the scripts' output there.

The button's label SHALL be "Run" before the first run, "Running…", disabled,
while a run is in progress, and "Run again" afterwards. A run started from the
terminal SHALL show on the button the same way. A project with a program SHALL
have no Run button.

#### Scenario: One press
- **WHEN** the user presses Run in a project holding `client/quickstart.ts`
- **THEN** the terminal opens, prints "Running client..." and the script's
  output, the button reads "Running…" until the script ends, then "Run
  again"

#### Scenario: A project with a program
- **WHEN** the open project's `src/` holds `lib.rs`
- **THEN** the stage row has no `flow-run` button

### Requirement: One callout above the editor says how the run went

In a project with no program, one callout (`client-run-callout`) SHALL sit
above the editor. It SHALL show whenever the project came from a docs link or
has been run, and its `data-state` SHALL name the state shown:

| `data-state` | Title | Body |
| --- | --- | --- |
| `source` | "From {host}: {title}", or "From a docs link: {title}" when the link had no `from` | "Runs with your Playground wallet." When the link had `from`, plus "View the docs page", which opens `from` in a new tab |
| `done` | "Ran in {s} s" | "Signatures and Explorer links are in the terminal." |
| `failed` | "Run failed" | The script's error message |
| `missing-package` | "Playground can't load `{package}` yet" | "This script imports it, so nothing ran." |

`source` shows only before the first run of a project from a docs link. A
project the user opened any other way shows the callout only after it is run.
In the callout, every state after a run SHALL offer "Run again", except
`missing-package`: running it again cannot load the package either. When
another project opens, the callout SHALL clear; a run in progress keeps its
state until it ends.

#### Scenario: The Quickstart runs to the end (manual)
- **WHEN** the Quickstart's script finishes without an uncaught error after
  12.4 s
- **THEN** the callout shows `done` with "Ran in 12 s"

#### Scenario: A failure midway
- **WHEN** the script throws "fetch failed" at its third step
- **THEN** the callout shows `failed` with "fetch failed", and the
  terminal keeps the output of the first two steps

#### Scenario: An error the script does not await
- **WHEN** the script starts a promise it never awaits, and that promise
  rejects with "boom" before the script ends
- **THEN** the callout shows `failed` with "boom"

#### Scenario: An import Playground cannot load
- **WHEN** the script imports `@solana-program/memo`
- **THEN** the callout shows `missing-package` naming
  `@solana-program/memo`, and no line of the script ran

### Requirement: Run asks for SOL the link says the script needs

When a project came from a docs link with `sol`, and the Playground wallet's
balance on the current endpoint is below it, Run SHALL NOT start the script.
The callout SHALL instead show "Not enough SOL on devnet"
(`client-run-funding`). It SHALL give:

- the wallet's address, its balance and the amount needed;
- "Copy address";
- "Get devnet SOL", which opens `https://faucet.solana.com` in a new tab;
- "Check again", which reads the balance again and starts the run once it is
  enough;
- "Not now", which goes back to the callout's previous state.

When no Playground wallet exists, Run SHALL first create one, as the wallet's
own setup does, and then check its balance.

#### Scenario: A new wallet
- **WHEN** a user with an empty Playground wallet presses Run on the
  Quickstart link's project (`sol=0.02`)
- **THEN** the funding card shows the wallet's address, "0 SOL" and
  "0.02 SOL", and no line of the script ran

#### Scenario: Funded while the card shows
- **WHEN** the user funds the wallet at faucet.solana.com and presses
  Check again
- **THEN** the card goes, and the run starts

### Requirement: Scripts can use Kit and the Token-2022 client

A script SHALL be able to import `@solana/kit`, `@solana/kit-plugin-rpc`,
`@solana/kit-plugin-signer`, `@solana-program/system` and
`@solana-program/token-2022`. In a script, `signerFromFile(<path>)` SHALL use
the Playground wallet as the client's identity and payer, whatever the path.
When the current wallet is not the Playground wallet, it SHALL fail with
"signerFromFile uses your Playground wallet. Switch to it to run this
script." Scripts SHALL run with ES2020 semantics: BigInt literals, numeric
separators, and `for…of` over a `Map` or `Set` behave as in Node. A script
SHALL run in strict mode, as a module does in Node: an assignment to an
undeclared name fails the run.

#### Scenario: The Quickstart's client
- **WHEN** a script builds `createClient().use(signerFromFile("wallet.json")).use(solanaDevnetRpc()).use(systemProgram()).use(token2022Program())`
- **THEN** `client.identity.address` is the Playground wallet's address

#### Scenario: Iterating a Map
- **WHEN** a script runs `for (const [k] of new Map([["a", 1]])) console.log(k)`
- **THEN** the terminal prints `a`

### Requirement: Runs are measured

The `docs-link` slice SHALL send:

- `docs_link_run_started` when a `run` starts in a project a docs link
  opened, from the stage row's Run or typed in the terminal. Whether a docs
  link opened the project is taken when the run starts. Its `via` is always
  `link`, kept for the reports that read it.
- `docs_link_run_finished` when such a run ends. Its `outcome` is `done`,
  `failed` or `missing-package`, its `via` is `link`, and `seconds` is the
  run's whole seconds.
- `docs_link_run_funding_shown` when the funding card shows. Its `funding_state` is
  `new` when Run had to create the wallet, else `existing`.

A run in a project no docs link opened, from the terminal, the stage row's
Run or a tutorial's act card, SHALL send no `docs_link_run_*` event; the
`run` command's own `run_finished` and `run_errored` count every run. The
scenario on it is marked `(manual)`: `features/docs-link/model/run.test.ts`
holds it, not a Playwright test.

#### Scenario: A funded run (manual)
- **WHEN** a user with enough SOL presses Run on the Quickstart and it
  succeeds
- **THEN** `docs_link_run_started` with `via: "link"` is sent, then
  `docs_link_run_finished` with `via: "link"` and `outcome: "done"`

#### Scenario: A run no docs link opened (manual)
- **WHEN** a user runs a client file in a project no docs link opened
- **THEN** no `docs_link_run_started` or `docs_link_run_finished` is sent
