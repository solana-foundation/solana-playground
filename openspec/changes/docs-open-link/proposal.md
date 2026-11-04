# Proposal

## Why

The Solana docs Quickstart (HOO-2507) gets an "Open in Playground" button for
Breakpoint, and Payments and Assets pages will follow with the same button.
Today Playground cannot open a single file from a docs link. A project with no
program has nothing to run from the stage row. The script runtime cannot import
`@solana/kit` or the program clients the Quickstart is written with.

## What Changes

- A docs link, `/open#…`, carries one TypeScript file, compressed into the URL
  fragment: its name, a title, an optional source page, and an optional minimum
  SOL balance. Playground opens it as an unsaved client project. A fragment that
  does not decode shows "This link is broken". Gist and GitHub links are
  unchanged.
- The stage row of a project with no program gets a Run button (Run,
  Running…, Run again). It runs the project's client scripts, as `run` does in
  the terminal.
- One callout above the editor gives the run's state:
  - before a run: the source line, for a project opened from a docs link;
  - after a run: ran on devnet in N s, failed with the error, or "Playground
    can't load `<package>` yet".
- When the link asks for a minimum balance and the Playground wallet holds
  less, Run shows "Not enough SOL on devnet": the address, Copy address, a
  link to faucet.solana.com, and Check again. The public RPC faucet is closed
  (410), and Playground's own faucet is HOO-2533.
- Scripts can import `@solana/kit`, `@solana/kit-plugin-rpc`,
  `@solana/kit-plugin-signer`, `@solana-program/system` and
  `@solana-program/token-2022`. `signerFromFile(<any path>)` resolves to the
  Playground wallet. Scripts transpile to ES2020, not ES5, so BigInt, `Map`
  and `Set` iteration behave as in Node.
- New slice `features/docs-link` with telemetry events: `docs_link_opened`,
  `docs_link_failed`, `docs_link_run_started`, `docs_link_run_finished`,
  `docs_link_run_funding_shown`.

## Capabilities

### New Capabilities

- `docs-open-link`: opening one file from a docs link, the link's format, and
  the broken-link page
- `client-run`: running a client project from the stage row, the run's callout
  and the funding card

### Modified Capabilities

- `project-without-program`: the stage row of a project with no program
  carries a Run button next to the "Client project" label

## Impact

- `client-v2/src/features/docs-link` (new), `src/routes/open` (new),
  `src/views/flow/header/StageBar.tsx`, `src/views/flow/stages/Write.tsx`,
  `src/utils/js-runtime/js-runtime.ts`, `client-v2/package.json` (five
  packages, loaded on first import only, so the main bundle does not grow).
- The five packages go in a new `client-v2/supported-packages.json`. Its
  `importable` list is added to the root file's by `generate-packages.mjs` and
  `craco.config.js`. The root file stays upstream's: the upstream client reads
  it, and would fail to build on imports it does not install.
- Out of scope:
  - the button on the docs site;
  - the assistant's turn after a run;
  - the files toggle (DES-205);
  - the phone's chat-first layout (the phone keeps its frame, with the same
    Run and callout);
  - "Stopped by the script";
  - Playground's own faucet (HOO-2533).
