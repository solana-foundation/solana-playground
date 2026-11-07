# Wallet keys on their own origin: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The built-in wallet's key bytes are held and used only by a hidden
frame on a key origin of their own; the app page signs through it over a
`MessageChannel`.

**Architecture:** A third webpack entry `wallet-keys` (beside `main` and the
project-code `sandbox`) builds `wallet-keys.html`, served by the same
deployment on a second domain. The page side (`client.ts`) opens the hidden
frame, and a `key-origin` signer provider, built from the sandbox's
`signerMethodsWith`, signs through it. The page's account record carries
`publicKey`; `kp` only under the `local` provider. The build picks the
provider from `REACT_APP_WALLET_KEY_ORIGIN`.

**Tech Stack:** TypeScript, React 18, CRA via craco (webpack 5), vitest
(in-source `import.meta.vitest`), Playwright, `@noble/ed25519`.

**Spec:** `openspec/changes/wallet-key-origin/` (proposal, design, the two
spec deltas). Read `design.md` before any task.

## Global Constraints

- The `wallet-keys` entry imports only `@noble/ed25519` and files under
  `client-v2/src/utils/wallet/key-origin/frame/` and `key-origin/protocol.ts`.
  No web3.js, no `shared/lib/logger`, no app module. Task 3 checks this.
- No message, log line, error or thrown value carries key bytes in any
  encoding, except the `adopt` request (page → frame, once).
- Env: `REACT_APP_WALLET_KEY_ORIGIN` (unset → `local` provider; `loopback` →
  same port on the other loopback host; else an origin like
  `https://wallet-keys.playground.solana.com`); `REACT_APP_WALLET_APP_ORIGIN`
  (the app origin the frame answers; `loopback` → the pair).
- Protocol version `1`, sent in `ready` and the handshake.
- Handshake timeout 10 000 ms.
- Key store IndexedDB name `pg-wallet-keys`, Web Lock `pg-wallet-keys`.
- CLI error text, exact: "The built-in wallet's key is kept on its own origin, so the solana, spl-token and anchor commands cannot sign with it. Connect a wallet, or use the Deploy button."
- Panel failure text, exact: "Key storage didn't load. Reload the page and try again."
- Commit style: Conventional Commits, `feat(client-v2): …`; never a merge
  commit; no co-author trailers.
- Commands from `client-v2/` with `PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH`.
  Unit: `yarn vitest run <file>`. Types: `yarn test-types`. Lint: `yarn lint`.

## Review Focus

1. A second app tab opening while the move runs: it must wait on the lock
   and then load the moved record (Task 7 test "two tabs").
2. A frame that answers `ready` from the wrong origin or a different
   `contentWindow` (an extension's frame): no port handed out (Task 4 test).
3. A `message` sign request whose bytes are a valid transaction message:
   refused (Task 2 test).
4. The page reloaded mid-move (record still has `kp`, frame already holds the
   keys): `adopt` is idempotent, the next load finishes the move (Task 7).
5. Theme switched while a dialog shows a panel: colours update (Task 8).

---

### Task 1: Protocol and origins

**Files:**
- Create: `client-v2/src/utils/wallet/key-origin/protocol.ts` (in-source tests)
- Create: `client-v2/src/utils/wallet/key-origin/origin.ts` (in-source tests)

**Interfaces:**
- Produces:
  - `KEY_PROTOCOL_VERSION = 1`
  - `type KeyRequest = { id: number } & ({ type: "accounts" } | { type: "create" } | { type: "keep"; publicKey: string } | { type: "sign"; publicKey: string; kind: "transaction" | "message"; bytes: Uint8Array } | { type: "forget"; publicKey: string } | { type: "adopt"; keys: number[][] })`
  - `type KeyReply = { id: number } & ({ ok: true; result: string[] | string | Uint8Array | null } | { ok: false; error: string })` — `accounts`/`adopt` → `string[]`, `create` → `string`, `sign` → `Uint8Array(64)`, `keep`/`forget` → `null`
  - `type KeyReady = { type: "pg-wallet-keys:ready"; version: number }`, `type KeyHandshake = { type: "pg-wallet-keys:connect"; version: number }`
  - `isKeyRequest(x: unknown): x is KeyRequest`, `isKeyReply(x: unknown): x is KeyReply`, `isKeyReady(x: unknown): x is KeyReady`, `isKeyHandshake(x: unknown): x is KeyHandshake`
  - `keyOriginFor(setting: string | undefined, here: Location | URL): string | null` — `undefined`/`""` → `null`; `"loopback"` → swaps `localhost` ↔ `127.0.0.1`, same protocol and port; else `new URL(setting).origin`
  - `appOriginFor(setting: string | undefined, here: Location | URL): string | null` — the same rules, used by the frame

- [ ] **Step 1: Write failing tests**: validators accept each request/reply shape and reject `{}`, a wrong `type`, a `sign` whose `bytes` is a `number[]`, an `adopt` key of 63 bytes; `keyOriginFor("loopback", new URL("http://localhost:3006/x"))` → `"http://127.0.0.1:3006"` and the reverse; `keyOriginFor(undefined, …)` → `null`; `keyOriginFor("https://wallet-keys.example.com/a", …)` → `"https://wallet-keys.example.com"`; `"loopback"` on a non-loopback host → `null`.
- [ ] **Step 2: Run** `yarn vitest run src/utils/wallet/key-origin/` → FAIL (missing modules).
- [ ] **Step 3: Implement** both files. Imports: none beyond each other.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(client-v2): the key origin's protocol and origin settings`.

### Task 2: The key page's store and handler

**Files:**
- Create: `client-v2/src/utils/wallet/key-origin/frame/store.ts`
- Create: `client-v2/src/utils/wallet/key-origin/frame/handler.ts`
- Test: in-source in both; reuse the fake IndexedDB pattern of `keystore.ts` tests (copy the minimal fake into `frame/store.ts`'s test block; do not import `keystore.ts`).

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `interface KeyStore { all(): Promise<Map<string, Uint8Array>>; put(entries: [string, Uint8Array][]): Promise<void>; remove(publicKey: string): Promise<void> }`
  - `indexedDbKeyStore(name = "pg-wallet-keys"): KeyStore` — one object store `keys`, key = base58 public key, value = `number[]` (64); every write under `navigator.locks.request("pg-wallet-keys", …)` when `navigator.locks` exists.
  - `handlerWith(store: KeyStore): (request: KeyRequest) => Promise<KeyReply>` — drafts in a `Map` in memory; `create` uses `ed25519.utils.randomPrivateKey()` + `getPublicKey`, 64 bytes = private ‖ public, base58 via a local encoder (no `bs58` package unless already a direct dep — check `package.json`; if it is, it is allowed in the entry); `sign` looks up stored then draft; `transaction` → signs bytes; `message` → refuses with `"This message is a transaction"` when the bytes deserialize as a legacy or v0 message (check: first byte `& 0x80` with version 0 prefix, or legacy header that consumes the whole buffer — write `looksLikeTransactionMessage(bytes): boolean` with tests for a real serialized legacy and v0 message built in the test via `PgWeb3`; the test may import web3, the module may not); `adopt` validates each key (public half matches `getPublicKey(private half)`), `put`s, re-reads with `all()`, returns the public keys present; errors are `{ ok: false, error: <message> }`, and an error message never contains key bytes; unknown public key → `"No key for account <base58>"`.

- [ ] **Step 1: Failing tests**: create→sign→verify with `ed25519.verify`; draft not in `all()` until `keep`; `forget` removes; `adopt` of 3 keys returns 3 public keys and a second `adopt` of the same keys returns the same 3 (idempotent); `adopt` of a key whose halves do not match → error, nothing stored; `message` sign of a serialized transaction message → refused; reply JSON of every op never contains any stored key's bytes (stringify and search for the first 8 bytes as a comma list).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(client-v2): the key page holds the wallet's keys and signs`.

### Task 3: Entry, page, panel and headers

**Files:**
- Create: `client-v2/src/utils/wallet/key-origin/frame/index.ts` (entry), `client-v2/src/utils/wallet/key-origin/frame/wallet-keys.html`, `client-v2/src/utils/wallet/key-origin/frame/panel.ts`
- Modify: `client-v2/craco.config.js` (add the entry like `addSandboxEntry`; dev-server headers for `/wallet-keys.html` read from `vercel.json` like `RUNTIME_CSP`; dev server accepts the `127.0.0.1` host), `client-v2/vercel.json`
- Test: `client-v2/scripts/wallet-keys-entry.test.mjs` (node --test, run by `yarn test-api`): builds nothing; parses `craco.config.js`'s entry list and asserts the entry's import graph (walk static imports from `frame/index.ts` with TypeScript's parser) stays inside `key-origin/` and `@noble/ed25519`.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: the frame at `/wallet-keys.html`.
  - Hidden mode (no fragment): posts `KeyReady` to `parent` with target origin = `appOriginFor(...)`; on a `KeyHandshake` from that origin and `event.source === parent`, takes `event.ports[0]` and serves `handlerWith(indexedDbKeyStore())` on it. Anything else is ignored.
  - Panel mode `#panel/import?theme=<b64 json>` and `#panel/export/<publicKey>?name=<name>&theme=…`: renders one `<button>` styled from the theme tokens (`--bg`, `--fg`, `--border`, `--radius`, `--font`, `--focus`); also posts `KeyReady` and serves a reduced channel that accepts `{type:"theme", tokens}` (live updates) and sends `{type:"imported", publicKey}`, `{type:"exported"}`, `{type:"error", message}`, `{type:"busy", busy}`. Import: hidden `<input type=file accept=".json">`, parse 64-number JSON, validate halves, store as draft via the same handler, send `imported`. Export: `Blob` of `JSON.stringify(Array.from(kp))`, `<a download="<name>-keypair.json">` click. Focus ring from `--focus` on `:focus-visible`.
  - `vercel.json`: header rule for `/wallet-keys.html` with `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self' https://*.vercel.app http://localhost:* http://127.0.0.1:* https://playground.solana.com` and `Cross-Origin-Resource-Policy: cross-origin`; a rewrite placed first: `{ "source": "/((?!wallet-keys\\.html|static/js/wallet-keys).*)", "has": [{ "type": "host", "value": "wallet-keys\\..*" }], "destination": "/404" }`.

- [ ] **Step 1: Failing test** `wallet-keys-entry.test.mjs` (import graph) → run `yarn test-api` → FAIL.
- [ ] **Step 2: Implement** entry, page, panel, craco, vercel.json.
- [ ] **Step 3: Run** `yarn test-api` → PASS; `yarn build:bundle` is not run here (CI); run `yarn dev:with-stubs` on your slot's port and `curl -sI http://127.0.0.1:<port>/wallet-keys.html` → 200 with the CSP header.
- [ ] **Step 4: Commit** `feat(client-v2): serve the key page on its own entry, with its own CSP`.

### Task 4: Page-side client

**Files:**
- Create: `client-v2/src/utils/wallet/key-origin/client.ts` (in-source tests, jsdom)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `interface KeyFrame { request<T>(body: DistributiveOmit<KeyRequest, "id">): Promise<T>; close(): void }`
  - `connectKeyFrame(origin: string, opts?: { timeoutMs?: number; doc?: Document }): Promise<KeyFrame>` — appends a hidden iframe (`src = origin + "/wallet-keys.html"`, `width=0 height=0`, `tabindex=-1`, `aria-hidden=true`, style `position:absolute;border:0;left:-9999px`), waits for a `KeyReady` whose `event.origin === origin` and `event.source === frame.contentWindow` and `version === KEY_PROTOCOL_VERSION`, sends `KeyHandshake` with `port2`, then talks over `port1`. Rejects with `KeyFrameUnavailable` (exported class, `reason: "timeout" | "version"`) after 10 000 ms or on a version mismatch, and removes the frame.
  - `keyFrame(): Promise<KeyFrame>` — the page's one connection, made on first use from `keyOriginFor(process.env.REACT_APP_WALLET_KEY_ORIGIN, location)`; a rejection is not cached, so "Try again" reconnects.

- [ ] **Step 1: Failing tests**: a fake frame that answers ready → request round-trip; ready from a different `source` → ignored, then timeout rejects with `reason: "timeout"`; ready from a different origin → ignored; version 2 → `reason: "version"`; replies matched by `id` out of order.
- [ ] **Step 2–4:** run FAIL, implement, run PASS.
- [ ] **Step 5: Commit** `feat(client-v2): connect the page to the key page over a MessageChannel`.

### Task 5: Account record by public key

**Files:**
- Modify: `client-v2/src/utils/wallet/types.ts:23-29` (`WalletAccount = { name: string; publicKey: string; kp?: number[] }`), `client-v2/src/utils/wallet/wallet-storage.ts` (validation accepts an account with `publicKey` and no `kp`; fills `publicKey` from `kp` for an old record on read; dedupe at :129/:135/:204 by `publicKey`), `client-v2/src/utils/wallet/wallet.ts` (`signerProvider` lookup at :43, `add` dedupe at :419, `create` at :594 read `publicKey`)
- Test: existing `wallet-storage.ts` in-source tests, `wallet.test.ts`

**Interfaces:**
- Produces: every `WalletAccount` read from storage has `publicKey` (base58). `kp` present under `local`. Writes keep `kp` when present.

- [ ] **Step 1: Failing tests**: an old record `{kp, name}` reads with `publicKey` = `publicKeyOf(kp).toBase58()`; a record `{name, publicKey}` (no `kp`) is a valid account, not damaged; a record whose `kp` and `publicKey` disagree is damaged (set aside).
- [ ] **Step 2–4:** FAIL, implement, `yarn vitest run src/utils/wallet/` PASS (all existing tests too).
- [ ] **Step 5: Commit** `refactor(client-v2): address the wallet's accounts by public key`.

### Task 6: Key-origin provider and boot selection

**Files:**
- Create: `client-v2/src/utils/wallet/key-origin/provider.ts` (in-source tests)
- Modify: `client-v2/src/utils/wallet/signer-provider.ts` (interface gains `holdsKeysInPage: boolean`, `makeKey(): Promise<string>` (draft), `keepKey(publicKey: string): Promise<void>`, `forgetKey(publicKey: string): Promise<void>`; `local`: `holdsKeysInPage: true`, `makeKey` generates and keeps the keypair in a draft map, `keepKey` no-op, `forgetKey` no-op, and `walletFor` also finds drafts), `client-v2/src/utils/wallet/wallet.ts` (`add` takes `{ name?, publicKey?, keypair? }`; under `holdsKeysInPage === false` it never stores `kp` and calls `keepKey`; `remove` calls `forgetKey`; derive's "no accounts → add()" becomes `void PgWallet.addNew()` = `makeKey` then `add`; `getKeypairBytes` and `export` throw the CLI message under the key-origin provider; provider chosen at module init: key origin set → `keyOriginSignerProvider()`), `client-v2/src/features/deploy/model/stage-deploy.ts:83` (`await PgWallet.addNew()`)

**Interfaces:**
- Consumes: Tasks 4–5; `signerMethodsWith`, `sandboxKeypairWith` from `sandbox-signer-provider.ts`.
- Produces: `keyOriginSignerProvider(frame: () => Promise<KeyFrame>): WalletSignerProvider` with `name: "key-origin"`, `holdsKeysInPage: false`; `walletFor` → `{ isPg: true, keypair: sandboxKeypairWith(sign)(publicKey), name, publicKey, ...signerMethodsWith(sign)(publicKey) }` where `sign = pk => kind => bytes => frame().then(f => f.request<Uint8Array>({ type: "sign", publicKey: pk.toBase58(), kind, bytes }))`; `secretKeyFor` throws `CLI_KEY_ERROR` (exported, the exact text above). `PgWallet.addNew(name?: string): Promise<boolean>`.

- [ ] **Step 1: Failing tests** with a fake `KeyFrame` backed by Task 2's `handlerWith` over an in-memory store: a legacy and a v0 transaction signed by the provider verify; `secretKeyFor` throws `CLI_KEY_ERROR`; `wallet.keypair.secretKey` throws `SECRET_KEY_ERROR`; `PgWallet.addNew()` under the key-origin provider stores an account with `publicKey` and no `kp` and the fake store holds the key.
- [ ] **Step 2–4:** FAIL, implement, PASS; `yarn test-types` clean.
- [ ] **Step 5: Commit** `feat(client-v2): sign the built-in wallet through the key page when the build names a key origin`.

### Task 7: One-time move

**Files:**
- Create: `client-v2/src/utils/wallet/key-origin/move.ts` (in-source tests)
- Modify: `client-v2/src/utils/wallet/wallet.ts` (`storage.read` under the key-origin provider: after the record is read, run `moveKeysOut` inside `walletStorage().exclusive`; a `KeyFrameUnavailable` or a failed move → `state: "unavailable"` and no write), `client-v2/src/utils/wallet/wallet-storage.ts` (expose the set-aside copies' keys and `localStorage['wallet']` keys to the move; a method to clear them after it)

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces: `moveKeysOut(record: SerializedWalletState, extraKeys: number[][], frame: KeyFrame): Promise<{ record: SerializedWalletState; moved: number }>` — no `kp` anywhere → returns the record, `moved: 0`, sends nothing; else `adopt` all keys (record + extra), checks every record account's `publicKey` is in the reply, returns the record with `kp` removed; throws `MoveIncomplete` (exported; message lists public keys only) when any is missing.

- [ ] **Step 1: Failing tests**: three accounts move and the returned record has no `kp` and the same `currentIndex`; the frame's reply lacks one key → throws, nothing written (assert the store's `write` was not called); a record with no `kp` → no `adopt` sent; two concurrent loads through one `exclusive` fake → `adopt` once with keys, second load sees a record without `kp`; a reload mid-move (frame holds keys, record has `kp`) → move completes; the logged failure contains no key bytes.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(client-v2): move the page's wallet keys into the key origin, copy then confirm then drop`.

### Task 8: Dialogs

**Files:**
- Create: `client-v2/src/components/Wallet/KeyPanel.tsx` — `<KeyPanel action="import" onImported={(publicKey) => …} />` / `<KeyPanel action="export" publicKey name />`: an iframe sized to the DS button it replaces (read the size from the DS button's tokens), transparent, `border: 0`, `scrolling="no"`, `allow-downloads` via `sandbox="allow-scripts allow-same-origin allow-downloads"`, theme tokens from the current theme's CSS variables, re-sent on theme change; on `KeyFrameUnavailable` renders the muted line (exact text above); results go to the dialog's existing text and toasts.
- Modify: `client-v2/src/components/Wallet/Modals/Setup.tsx:19-43`, `Modals/Add.tsx:14-56`, `Settings.tsx:59,193`, `Modals/Remove.tsx:33` — under the `local` provider nothing changes; under `key-origin` the key is a draft from `makeKey()` instead of `useState(Keypair.generate)`, the export button is `<KeyPanel action="export">`, the import button is `<KeyPanel action="import">` whose `onImported` calls `PgWallet.add({ publicKey })`.
- Test: in-source tests for `KeyPanel` with a fake frame (theme re-sent on change; failure line on unavailable); existing dialog tests stay green.

- [ ] **Step 1–4:** failing tests, implement, PASS.
- [ ] **Step 5: Screenshots** (Playwright, `loopback`, own slot port): Setup and Settings, dark and light, one with keyboard focus on the panel button, and the failure line (block `127.0.0.1` with `page.route`). Save under the scratchpad for the PR.
- [ ] **Step 6: Commit** `feat(client-v2): import and export the built-in wallet's key file inside the key origin`.

### Task 9: e2e

**Files:**
- Create: `client-v2/e2e/wallet-key-origin.e2e.spec.ts`
- Modify: `client-v2/playwright.config.mts` (pass `REACT_APP_WALLET_KEY_ORIGIN=loopback` and `REACT_APP_WALLET_APP_ORIGIN=loopback` to the web server env), `.github/workflows/client-v2.yml` only if the env must be set there too

**Tests** (names are spec scenarios):
- `wallet-storage: Three accounts move` — seed `pg-wallet` with three `kp` accounts via `seedLocalWallet`, load, then assert in the app origin: IndexedDB `pg-wallet` record and every `localStorage` value contain no 64-number array; the account menu lists the three names.
- `wallet-signing: Project code signs through the page and the key page` — `run` a client that signs a transfer with `pg.wallet.keypair` against the e2e's mocked RPC (copy the pattern of `project-code-sandbox.e2e.spec.ts:199`).
- `wallet-storage: The key origin is blocked` — `page.route("http://127.0.0.1:*/**", r => r.abort())`; the wallet reads unavailable; the stored record is unchanged.

- [ ] **Step 1:** write the spec; **Step 2:** `yarn test-e2e:with-stubs e2e/wallet-key-origin.e2e.spec.ts` → PASS; **Step 3:** commit `test(client-v2): e2e for the wallet's key origin`.
