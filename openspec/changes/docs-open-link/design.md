# Design

## Context

The docs Quickstart (HOO-2507) is one TypeScript file on `@solana/kit` with its
plugins and the Token-2022 client: five steps on devnet. The design is Almaz's
stand (`playground-ts-only-quickstart`, DES-203). It shows:

- a docs page with an "Open in Playground" button;
- a client project with Write, "Client project" and Run in the stage row;
- one callout above the code;
- a funding card, and a broken-link page.

Kat confirmed the stand on 3 Nov. The docs team ships the file. The stand's
script is a stand-in, and is used here as the test fixture.

What exists on `scope/typescript-2`:

- A gist opens from `/gist/<id>` as an unsaved view
  (`PgExplorer.init({ files })`), and a project with no program shows only
  Write (`project-without-program`).
- Scripts run through `PgJsRuntime.execute`. The runtime transpiles to ES5,
  takes imports by regex, and loads only the packages `generate-packages.mjs`
  writes into `js-runtime/package.ts` from `supported-packages.json`.
- The public devnet RPC faucet answers 410 since 3 Nov. Slava's call that day
  (14:30): the faucet card is the path for now, and Playground's own faucet is
  HOO-2533.

## Goals / Non-Goals

**Goals:** any docs page can carry one file in a link; the Quickstart runs to
the end with one Run; every end state reads in one place.

**Non-Goals:**

- the docs site button;
- the assistant's turn after a run;
- the files toggle (DES-205);
- the phone's chat-first layout;
- "Stopped by the script";
- a faucet of our own.

## Decisions

**The code travels in the fragment, deflated.** The stand's broken-link copy
("cut off when it was copied") means the code is in the link. A fragment:

- never reaches a server, so there are no logs and no limit there;
- deflates the Quickstart (~4 KB) to about 2 KB of base64url, well inside
  every browser's URL limit;
- leaves the docs team no file to host. They build the link with Node's
  `zlib.deflateRawSync`.

Inflating uses `pako`, which is already a dependency, so it runs synchronously
in the route. Rejected alternatives:

- a gist per docs page: someone has to own the gists, and the docs would
  depend on GitHub's rate limit;
- `?url=` to a raw file: CORS, and the docs host has to serve it.

`from` and `sol` are our additions to the stand. They are documented in the
link format handed to the docs team.

**A new route, `/open`, and a `features/docs-link` slice.** The slice holds:

- `lib/link.ts`: encode, decode and the broken-link reasons, pure and
  tested in-source;
- `model/run.ts`: a small store for the run's state;
- `model/telemetry.ts`;
- `ui/`: `BaseRunButton`/`RunButton`, `BaseRunCallout`/`RunCallout`,
  `BaseBrokenLink` (the `/open` route connects it).

`routes/open` decodes the link. A good link opens
`handleRoute({ getExplorerInitArg })` with `client/<name>` and records the
link's `title`, `from` and `sol` in the slice's store. A bad link renders
`BaseBrokenLink` as the main view. The legacy `StageBar` (Run) and `Write`
(callout above `Primary`) import the slice. They are legacy roots, so the
layer check allows it. Run belongs to the slice because the docs link is the
first thing that needs it. A later rename to a `client-run` slice is cheap,
and the telemetry prefixes stay.

**Run state is a discriminated union**:

```text
idle | funding | running | done | failed | missing-package
```

`done` holds `ms`, `failed` holds `message`, `missing-package` holds
`pkg`, `running` holds when it started and whether a link opened its project. Two signals tell the store how a run ended:

- `PgJsRuntime.execute` now returns `{ ok: true } | { ok: false, error }`.
  The wrapper code reports a caught error through an `__fail` global, next to
  `__end`.
- A thrown `Package \`x\` is not available.` is matched by one exported
  predicate (`missingPackageOf`) and becomes `missing-package`.

The Run button calls `PgCommand.run.execute()`. It does not call the runtime
directly, so the terminal prints exactly what `run` prints. The store
listens to `PgCommand.run`'s start and finish events, so a run typed in the
terminal shows on the button too.

**Funding asks only when the link says how much.** A generic project can be a
read-only script. Only a link with `sol` triggers the card. The balance is
read from the chain (`PgConnection.current.getBalance`), not the wallet's
cached one, so Check again sees a faucet's transfer. Wallet states `setup` and
`disconnected` run `PgCommand.connect` (the setup modal for the first), then
check the balance; a browser wallet is not checked, since `signerFromFile`
uses the Playground wallet only.

**Kit in the runtime.** The five packages go in
`client-v2/supported-packages.json`. `generate-packages.mjs` and
`craco.config.js` merge its `importable` with the root's. The root stays
upstream's, because the upstream client reads it.

`_overridePackage("@solana/kit-plugin-signer")` replaces `signerFromFile`
with a plugin. It reads `PgWallet.current.keypair.secretKey`, runs
`createKeyPairSignerFromBytes`, and sets `identity` and `payer`. A non-Playground
wallet throws the spec's message.

The transpile target moves from ES5 to ES2020. ES5 silently skips `for…of`
over a `Map` (it reads `.length`), and kit code does that. BigInt literals pass
through either way. Every browser Playground supports runs ES2020.

**Bundle.** `import("<pkg>")` in the generated `package.ts` already makes one
lazy chunk per package. `main` does not grow; `other chunks` grows by the kit
packages, roughly 150 kB gzip, explained in the PR's bundle line.

## Risks / Trade-offs

- **The docs team's final file may import something else.** The
  missing-package state names it. Adding a package is one line in
  `client-v2/supported-packages.json`.
- **Public devnet RPC may rate-limit five steps in a row.** The failure state
  shows the error, and Run again retries. Our own RPC is outside this change.
- **ES2020 changes the runtime for every script.** It only removes ES5
  down-levelling. A script that passed before still parses. CI's e2e
  `run`/`test` specs cover it.
- **The funding card links out** until HOO-2533 lands a faucet of our own.
