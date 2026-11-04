# docs-open-link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a docs link opens one TypeScript file in Playground as a client
project, and one Run takes it to the end, with its outcome in one callout.

**Architecture:** the slice `features/docs-link` holds the link codec, the
run store, the telemetry and the UI pairs. `routes/open` decodes and opens.
The legacy `StageBar` and `Write` mount the Run button and the callout. The
runtime gains five Kit packages, a `signerFromFile` override, an ES2020
target and a run result.

**Tech Stack:** React 17, styled-components and Tailwind with `shared/ui`
(`Button`, `Callout`, `CopyButton`), `pako`, vitest in-source blocks,
Playwright.

**Spec:** `openspec/changes/docs-open-link/` (proposal, design, the
`docs-open-link`, `client-run` and `project-without-program` deltas).

## Global Constraints

- Link: `/open#v=1&name=…&code=…[&title=…][&from=…][&sol=…]`. `code` is
  base64url, without padding, of raw DEFLATE of the UTF-8 text.
- `name`: `/^[A-Za-z0-9._-]+\.(ts|js)$/`. The inflated text is non-empty and
  at most 100 KB (102400 bytes). `from` must parse as an `https:` URL; `sol`
  is a positive finite number.
- Ids: `docs-link-broken`, `docs-link-back`, `docs-link-home`, `flow-run`,
  `client-run-callout` (with `data-state`), `client-run-funding`.
- Copy exactly as in the spec tables, including "Playground couldn't read the
  code in this link. It may have been cut off when it was copied. Open the
  page in the docs again and use its Open in Playground button."
- Telemetry prefix: `docs-link` maps to two prefixes. The events are named
  `docs_link_*` and `docs_link_run_*` per the spec. If `prefixes.ts` allows only
  one prefix per slice, name the run events `docs_link_run_*` and update the
  spec delta in the same commit.
- "Back to the docs" fallback is `https://solana.com/docs`. "Get devnet SOL"
  goes to `https://faucet.solana.com`.
- No nested ternaries, no empty `catch`, imports across layers via `@/`.

## Review Focus

1. A `from` of `javascript:` or `http:`: never used as a link, so the fallback
   applies. Test in Task 2.
2. A `+` or `/` in `code` (plain base64, not base64url) still decodes. Accept
   both alphabets. Test in Task 2.
3. A second docs link opened while a project is open replaces the view, and
   the callout's `source` follows the new link. Test in Task 4.
4. A run typed in the terminal (`run`) in a docs project updates the button
   and the callout. Test in Task 4.
5. A wallet switched to a standard wallet: `signerFromFile` fails with the
   spec's message, and the callout shows `failed`. Test in Task 1.

---

### Task 1: Runtime: Kit packages, signer, ES2020, run result

**Files:**
- Create: `client-v2/supported-packages.json` (`{ "importable": [five names] }`)
- Modify: `client-v2/scripts/generate-packages.mjs`, `client-v2/craco.config.js` (merge `importable`)
- Modify: `client-v2/src/utils/js-runtime/js-runtime.ts` (`execute` result, `__fail`, ES2020, `_overridePackage` for `@solana/kit-plugin-signer`)
- Modify: `client-v2/src/commands/run-and-test/run-and-test.ts` (`run` returns the first failure)
- Create: `docs/open-in-playground-link.md`, the format for the docs team
- Test: `client-v2/src/utils/js-runtime/js-runtime.test.ts`

**Interfaces:**
- Produces:
  - `type RunResult = { ok: true } | { ok: false; error: string }`, returned
    by `PgJsRuntime.execute` and by `PgCommand.run.execute()`;
  - `export const missingPackageOf = (message: string): string | null` in
    `js-runtime.ts`, re-exported from `utils/js-runtime/index.ts`;
  - `export const SIGNER_NEEDS_PG_WALLET = "signerFromFile uses your Playground wallet. Switch to it to run this script."`.

- [ ] **Step 1: Failing tests:**
  - `missingPackageOf("Package \`@solana-program/memo\` is not available.")`
    is `"@solana-program/memo"`, and `null` for `"fetch failed"`.
  - Transpiling `for (const [k] of new Map([["a",1]])) out.push(k)` with the
    runtime's options yields code that, run with `new Function`, pushes
    `"a"`. Export the options as `TRANSPILE_OPTIONS` for this test.
  - `_overridePackage("@solana/kit-plugin-signer", real)` gives a
    `signerFromFile("x.json")` whose plugin, applied to `{}` with a mocked
    Playground wallet, yields an `identity.address` equal to that wallet's
    base58 key. With a non-Playground wallet it rejects with
    `SIGNER_NEEDS_PG_WALLET`.
- [ ] **Step 2:** Run `yarn test-unit src/utils/js-runtime`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The override uses `createKeyPairSignerFromBytes(Uint8Array.from(PgWallet.current.keypair.secretKey))`
    from `@solana/kit` (dynamic import through `PgJsRuntimePackage`).
  - The wrapper's catch calls `__fail(e?.message ?? String(e))` before
    printing.
  - `execute` resolves with the first `__fail`, or `{ ok: true }`.
  - `processCommon` returns the first non-ok result.
- [ ] **Step 4:** Add the packages to `client-v2/supported-packages.json`,
  merge them in the two scripts, and run `yarn generate-packages`. Expected:
  `src/utils/js-runtime/package.ts` has five new `case`s.
- [ ] **Step 5:** Run `yarn test-unit src/utils/js-runtime && yarn test-types`.
  Expected: PASS.
- [ ] **Step 6: Commit:** `feat(client-v2): scripts import Kit and the Token-2022 client, signerFromFile is the Playground wallet (HOO-2507)`

### Task 2: The link codec and telemetry

**Files:**
- Create: `client-v2/src/features/docs-link/{index.ts,lib/link.ts,model/telemetry.ts}`
- Modify: `client-v2/src/shared/lib/telemetry/prefixes.ts`

**Interfaces:**
- Produces:
  - `type DocsLink = { name: string; code: string; title: string; from: string | null; sol: number | null }`;
  - `type DocsLinkFailure = "missing" | "version" | "decode" | "size" | "name"`;
  - `decodeDocsLink(fragment: string): { ok: true; link: DocsLink } | { ok: false; reason: DocsLinkFailure; from: string | null }`;
  - `encodeDocsLink(link: Omit<DocsLink, "title"> & { title?: string }): string`, which returns the fragment without `#`;
  - `backToDocsHref(from: string | null, referrer: string): string`;
  - `docsLinkTelemetry`.

- [ ] **Step 1: Failing in-source tests** (`features/docs-link/lib/link`):
  - the round trip of the stand's script keeps `name`, `code`, `title`,
    `from` and `sol`;
  - the default title for `hello.ts` is `"hello"`;
  - each failure: no `code` gives `missing`; `v=2` gives `version`; the code
    cut by 40 characters gives `decode`; 102401 bytes gives `size`;
    `a.rs` and `../a.ts` give `name`; `sol=-1` gives `missing`;
  - plain base64 with `+` and `/` decodes;
  - `backToDocsHref`: an https `from` wins; `javascript:alert(1)` and
    `http://x` fall back; a referrer `https://solana.com/docs/x` comes next;
    otherwise `https://solana.com/docs`.
- [ ] **Step 2:** Run `yarn test-unit src/features/docs-link/lib/link.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** with `pako.deflateRaw` and `pako.inflateRaw`,
  decoding with `TextDecoder("utf-8", { fatal: true })`. Declare the
  `docs_link_opened { host, bytes }` and `docs_link_failed { reason }`
  events, and the `docs_link_run_*` events from the spec, with doc comments.
  Register the prefix.
- [ ] **Step 4:** Run the tests, `yarn test-unit src/app/slice-structure.test.ts`
  and `yarn lint`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(client-v2): decode a docs link that carries one file (HOO-2507)`

### Task 3: `/open` and the broken-link page

**Files:**
- Create: `client-v2/src/routes/open/{index.ts,open.tsx,open.test.ts}`
- Create: `client-v2/src/features/docs-link/model/opened.ts`: the store of
  the link the open view came from; it clears when another route opens.
- Create: `client-v2/src/features/docs-link/ui/{BaseBrokenLink.tsx,BrokenLink.tsx}`

**Interfaces:**
- Consumes: `decodeDocsLink`, `backToDocsHref`, `handleRoute`.
- Produces: `PgDocsLink.opened: DocsLink | null` and
  `PgDocsLink.onDidChange(cb): Disposable`.

- [ ] **Step 1: Failing route tests**, mocking `handleRoute` as `gist.test.ts`
  does:
  - a good fragment opens `[["client/quickstart.ts", code]]`, sets `opened`
    and sends `docs_link_opened` with `host: "solana.com"`;
  - a bad one passes `main` that renders `BrokenLink`, opens no files, and
    sends `docs_link_failed`.
- [ ] **Step 2:** Run `yarn test-unit src/routes/open`. Expected: FAIL.
- [ ] **Step 3: Implement** the route at path `/open`. It reads
  `window.location.hash`. Add `open` to the routes barrel (`routes/index.ts`
  or the generated list, as the existing routes are). `BaseBrokenLink` uses
  `StageEmpty` and `Button` from `shared/ui`.
- [ ] **Step 4:** Run the tests and `yarn test-types`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(client-v2): open a docs link at /open, or say it is broken (HOO-2507)`

### Task 4: Run button, callout and funding

**Files:**
- Create: `client-v2/src/features/docs-link/model/run.ts`, the run store
- Create: `client-v2/src/features/docs-link/ui/{BaseRunButton,RunButton,BaseRunCallout,RunCallout}.tsx` and their `.test.tsx`
- Modify: `client-v2/src/views/flow/header/StageBar.tsx`, which renders
  `<RunButton />` when `!state.hasProgram`
- Modify: `client-v2/src/views/flow/stages/Write.tsx`, which renders
  `<RunCallout />` above `Primary` when `!PgFlow.state.hasProgram`

**Interfaces:**
- Consumes: `PgCommand.run.execute/onDidStart/onDidFinish`, `RunResult`,
  `missingPackageOf`, `PgDocsLink.opened`, `PgWallet.balance`,
  `PgWallet.state`, `PgCommand.connect`.
- Produces:
  - `type RunState = { kind: "idle" } | { kind: "funding"; balance: number; needed: number; address: string } | { kind: "running" } | { kind: "done"; ms: number } | { kind: "failed"; message: string } | { kind: "missing-package"; pkg: string }`;
  - `PgClientRun.start(): Promise<void>`, `checkAgain()` and `dismissFunding()`.

- [ ] **Step 1: Failing tests:**
  - `BaseRunButton`: "Run", "Running…" (disabled) and "Run again".
  - `BaseRunCallout`: for each `data-state` the spec's title and body, and
    "View the docs page" only with `from`.
  - The store with `PgCommand` mocked:
    - `onDidFinish` with `{ ok: { ok: true } }` after 12.4 s gives
      `done` and "Ran in 12 s";
    - `{ ok: { ok: false, error: "fetch failed" } }` gives `failed`;
    - `{ err: Error("Package \`@solana-program/memo\` is not available.") }`
      gives `missing-package`;
    - with `opened.sol = 0.02` and a balance of 0, `start()` does not run and
      gives `funding`;
    - a run started from the terminal (an `onDidStart` without `start()`)
      gives `running`.
  - Events: one test per `docs_link_run_*`, through the memory provider.
- [ ] **Step 2:** Run `yarn test-unit src/features/docs-link`. Expected: FAIL.
- [ ] **Step 3: Implement.** The funding card uses `CopyButton` with
  `onError={reportButtonFailure("copy the address")}`, and a link button to
  the faucet with `target="_blank" rel="noopener noreferrer"`. Wallet state
  `setup` awaits `PgCommand.connect.execute()` before reading the balance.
- [ ] **Step 4:** Run the tests, `yarn test-types` and `yarn lint`.
  Expected: PASS.
- [ ] **Step 5: Commit:** `feat(client-v2): run a client project from the stage row, with its outcome above the code (HOO-2507)`

### Task 5: e2e, the link format, the manual check

**Files:**
- Create: `client-v2/e2e/docs-open-link.e2e.spec.ts`. Titles are
  `docs-open-link: <scenario>` and `client-run: <scenario>`. Stub the devnet
  RPC with `page.route`.
- Create: `client-v2/e2e/fixtures/quickstart.ts`, the stand's script.
- Create: `docs/open-in-playground-link.md`, the format plus a Node snippet
  for the docs team.

- [ ] **Step 1:** Write the specs. Use a script that logs and needs no RPC
  for the `done` path. The Quickstart runs only in the manual check.
- [ ] **Step 2:** Run `yarn test-e2e e2e/docs-open-link.e2e.spec.ts`.
  Expected: PASS.
- [ ] **Step 3:** Run `yarn run check`. Expected: PASS.
- [ ] **Step 4: Commit:** `test(client-v2): e2e for the docs link and the stage row's Run (HOO-2507)`
- [ ] **Step 5 (manual):** on the local dev server, with a funded Playground
  wallet, the Quickstart link runs all five steps on devnet. Take
  screenshots of every state for the PR.
