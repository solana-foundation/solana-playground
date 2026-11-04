# Design

## Context

`PgFramework.exportWorkspace` (`client-v2/src/utils/framework.ts`) reads a
workspace's files, converts them with the framework `getFromFiles` finds,
and zips them. A project with no program finds no framework, so it throws
`UNKNOWN_FRAMEWORK` and the dialog (`ExportWorkspace.tsx`) falls back to a
plain zip. The framework conversions (`src/frameworks/*/export.ts`) rewrite
`pg.*` into Anchor's provider; they all assume a program.

In the browser, a client or test runs with `pg` (`connection`, `wallet`,
and, with a program, `PROGRAM_ID` and `program`), `sleep`, `console` and the
global packages of `supported-packages.json` (`web3`, `anchor`, `BN`,
`assert`, `borsh`, `BufferLayout`, `Buffer`, `mocha`) defined, inside an
async wrapper, so top-level `await` works. A test file runs under mocha's
BDD globals.

## Goals / Non-Goals

**Goals:**

- A TypeScript-only project exported with the TypeScript profile runs with
  `npm install`, `npm run client`, `npm test` and no edits.
- A project with a program exports byte for byte as before.

**Non-Goals:**

- Type-checking the exported project (`tsc` passes is not promised; it runs
  through `tsx`, which strips types).
- `pg.wallets`, `pg.program`, `pg.PROGRAM_ID`, and `signMessage` on the local
  wallet.

## Decisions

**A `playground.ts` shim, not a rewrite of every `pg.*` access.** Each
script gets `import { pg } from "<relative>/playground"`; `pg.connection`
and `pg.wallet` keep their spelling. The Anchor conversion's string
replacement (`pg.connection` -> `program.provider.connection`) works there
because it rewrites into a name nothing else declares; rewriting to a bare
`connection` breaks the common `const connection = pg.connection;` (a
temporal-dead-zone error). The shim also keeps `pg.wallet.signTransaction`
and `pg.wallet.keypair` working, which the replacements would have to list
one by one.

**Cluster and wallet (the ticket's grooming question).** Recommended and
taken: environment variables with local defaults. `SOLANA_RPC_URL` falls
back to the public endpoint of the cluster the Playground was on when the
user exported, so the code talks to the cluster it was written against
(devnet by default), never to the URL the Playground used: a platform RPC
(`REACT_APP_*_RPC_URL`) or a custom one can carry a key, and a zip gets
shared (Sergey, call of 3 Nov). A local validator keeps its URL; playnet and
an unknown cluster fall back to devnet. `PgConnection.cluster` already names
the cluster, so no request is made at export; `SOLANA_KEYPAIR` falls back to `~/.config/solana/id.json`, the
Solana CLI's keypair and the path the Anchor export's `Anchor.toml` already
uses. Alternatives: the Playground's setting alone (no way to point it
elsewhere without editing code), or exporting the Playground wallet's key
(a secret in a zip that gets shared; rejected). The keypair is read lazily
through a getter, so a client that uses only the connection runs on a
machine with no keypair. This changes nothing in the Playground's own UI;
it shows in the exported README.

**`tsx` and an ES module package.** Playground scripts use top-level
`await` and extensionless imports. `tsx` runs TypeScript as ES modules with
both, needs no build step, and mocha takes it through `--node-option
import=tsx` (mocha >= 9.1). `ts-node` with CommonJS, which the Anchor
export uses, rejects top-level `await`. `tsconfig.json` is there for the
editor (`moduleResolution: Bundler`, `noEmit`).

**The run scripts.** `npm run client` runs one file: `client/client.ts`,
else `client/index.ts`, `client/client.js` or `client/index.js`, else the
first top-level script under `client/` in path order, else the first one
anywhere under it. The README says how to
run any other (`npx tsx client/<file>`). `npm test` runs
`mocha "tests/**/*.{ts,js,tsx,jsx}"`, with the Playground's 30 s timeout
raised to 1 000 s for cluster round trips, as the Anchor export does.

**Imports for the Playground globals reuse `addImports`**
(`frameworks/common.ts`), and dependencies reuse `getJSDependencyMap`, split
out of `getJSDependencies`, which still returns its text. `assert` and
`buffer` are dropped from the dependencies: Node has them built in, and the
npm packages of those names are browser polyfills. The profile adds
`@solana/web3.js` always (the shim imports it) and dev dependencies `tsx`,
`typescript`, `@types/node`, and, with tests, `mocha` and `@types/mocha`
(and `@types/bn.js` when `bn.js` is a dependency).

**Generated files never replace the project's.** A project with no program
holds only `client/` and `tests/` after an import, but a user can create a
root `README.md`; the profile skips any file it would add at a path the
project already uses. The other files of the project are copied as they
are.

**A feature slice, `project-export`.** The profile is new code that is not
UI, so it follows the layers (`client-v2/CLAUDE.md`). The slice holds the
profile (`model/typescript-profile.ts`, pure, tested in-source), the flow
(`model/export.ts`: resolve the profile, convert, zip, send events) and the
events (`model/telemetry.ts`). `PgFramework` keeps the framework
conversion; reading a workspace (`readWorkspaceFiles`) and zipping
(`downloadZip`) are split out of `exportWorkspace` so the slice reuses
them, and `exportWorkspace` keeps its signature and output. A failed
download after a conversion is a `DownloadError` (`isDownloadFailure`): the
dialog does not retry it as is, since the plain zip would fail the same way. The dialog
stays where it is (legacy `views/`) and calls the slice; moving it is the
UI move rule's call when its design lands.

**The dialog's copy.** No design source covers export for a project with no
program; the copy in the spec is our decision (sent to the designers' batch
as a gap). The dialog reads the project's kind once on open; until the read
ends, and if it fails, it shows the program text.

**Events.** Prefix `export` for the slice. The designers' analytics plan
names `project_exported` and `project_action_failed` for the projects
menu; the `project` prefix belongs to that future slice, so this slice
keeps its own names and the same facts (`files` is their `file_count`).

## Risks / Trade-offs

- [A script declares its own `pg` or `sleep`] → the import is added only
  when the file reads `pg.` or calls `sleep(` and declares neither.
- [`tsx`'s ES module mode rejects a CommonJS-only pattern] → Playground
  scripts are ES module syntax already (they `import`); `require` is not
  available in the Playground either.
- [A dependency the code imports through a path the reader does not
  recognise] → same reader as the framework exports, same coverage; the
  README says to `npm install` what is missing.
- [A private RPC is faster than the public endpoint the zip falls back to]
  → `SOLANA_RPC_URL` sets it, and the README says so.
