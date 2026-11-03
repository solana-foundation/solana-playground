# Wallet keystore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The built-in wallet's state lives in IndexedDB, and a wallet in `localStorage['wallet']` moves there without loss.

**Architecture:** A pure storage module, `wallet-storage.ts`, builds `{ read, write }` from two injected stores (the IndexedDB keystore and `localStorage`); `wallet.ts` wires it into `updatable`. The existing `migrate` keeps upgrading the legacy `sk` format inside `localStorage`, and `read` then moves whatever `localStorage` holds into IndexedDB.

**Tech Stack:** TypeScript, raw `indexedDB`, vitest (jsdom), Playwright.

**Spec:** `openspec/changes/wallet-keystore/specs/wallet-storage/spec.md`, `design.md`

## Global Constraints

- Database `pg-wallet`, object store `state`, record key `wallet`; the value is the `SerializedWalletState` object.
- Logger namespace `wallet:storage`; failures logged with `report: true`.
- No log entry receives a state object, an account or a `kp`; only error name/message and account counts.
- `localStorage['wallet']` is removed only after IndexedDB reads back equal.

## Review Focus

- `localStorage['wallet']` holding invalid JSON: read treats it as absent and does not delete it (test in Task 2).
- Same public key in both stores with different names: one account, IndexedDB's name (test in Task 2).
- A `localStorage` account named like an IndexedDB one but with another key: kept, renamed `"<name> (2)"` (test in Task 2).
- Two writes in quick succession: the stored state is the second (test in Task 2).
- IndexedDB opens but `get` rejects on the first read: falls back to `localStorage`, logs once (test in Task 2).

---

### Task 1: Keystore over IndexedDB

**Files:**
- Create: `client-v2/src/utils/wallet/keystore.ts`

**Interfaces:**
- Produces: `interface WalletStore { get(): Promise<SerializedWalletState | null>; put(state: SerializedWalletState): Promise<void>; delete(): Promise<void> }` and `createIndexedDbStore(name = "pg-wallet"): WalletStore` (opens lazily, once; rejects when `indexedDB` is missing).

- [ ] Implement with `indexedDB.open(name, 1)`, `onupgradeneeded` creating store `state`; each op one transaction. No unit test (jsdom has no IndexedDB); covered by Task 3's e2e.
- [ ] `yarn test-types` passes. Commit.

### Task 2: Storage, migration, merge, fallback, logging

**Files:**
- Create: `client-v2/src/utils/wallet/wallet-storage.ts`, `client-v2/src/utils/wallet/wallet-storage.test.ts`
- Modify: `client-v2/src/utils/wallet/wallet.ts:30-56` (replace `storage`)

**Interfaces:**
- Consumes: `WalletStore` (Task 1).
- Produces: `createWalletStorage(params: { store: WalletStore; local: Pick<Storage, "getItem" | "setItem" | "removeItem">; defaultState: WalletState }): { read(): Promise<WalletState>; write(state: WalletState): Promise<void> }`, and `mergeWallets(primary: SerializedWalletState, other: SerializedWalletState): SerializedWalletState`.

- [ ] Write failing tests in `wallet-storage.test.ts` with an in-memory `WalletStore` and an in-memory `local`, one per spec scenario plus the Review Focus lines:
  - `moves a localStorage wallet into the store and removes the key`
  - `keeps localStorage when the store write fails` / `…when the read-back differs`
  - `merges both by public key, store first, renames a clashing name`
  - `reads from localStorage and logs once when the store cannot open`
  - `writes to localStorage when a store write fails`
  - `applies two quick writes in order`
  - `leaves invalid localStorage JSON in place`
  - `logs no keypair bytes`: run every failure path with `memoryProvider`, assert `JSON.stringify(entries)` contains neither the `kp` array's join nor its base64.
- [ ] Run `yarn vitest run src/utils/wallet/wallet-storage.test.ts`; expect FAIL (module missing).
- [ ] Implement. `read`: parse `local`; try store `get`; if `local` holds a wallet, `put(merge or local)`, `get` back, `PgCommon.isEqual` → `removeItem("wallet")` and `removeItem("walletName")`; any store failure sets `degraded = true` for the module's lifetime, logs, and returns `local`'s state. `write`: chained promise; `degraded` → `local.setItem`; store failure → log + `local.setItem`. Public key = `kp.slice(32)` compared bytewise.
- [ ] Wire into `wallet.ts`: `storage = createWalletStorage({ store: createIndexedDbStore(), local: localStorage, defaultState })`; keep `migrate` unchanged.
- [ ] Tests pass; `yarn vitest run src/utils/wallet` all pass. Commit.

### Task 3: e2e

**Files:**
- Create: `client-v2/e2e/wallet-storage.e2e.spec.ts`

- [ ] Test `wallet-storage: A localStorage wallet moves to IndexedDB`: `addInitScript` seeds `localStorage['wallet']` with a fixed keypair (state `pg`, one account), `seedWorkspace`, then poll `page.evaluate` until `localStorage.getItem("wallet") === null`, then read the `pg-wallet` record and assert its `accounts[0].kp` equals the seed; reload and assert the record still holds it and `localStorage` stays empty. The seed's init script must run only on the first load (guard with a `sessionStorage` flag).
- [ ] Run `yarn playwright test e2e/wallet-storage.e2e.spec.ts`; PASS. Commit.
