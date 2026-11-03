# Design

## Context

`PgWallet` is an `updatable` static class whose `storage` object reads and
writes `localStorage['wallet']` synchronously (`utils/wallet/wallet.ts`).
`updatable` already awaits `storage.read()` and `migrate()` in `init`, and
calls `storage.write()` on every change without awaiting it, so an async
store fits without touching the decorator. A `migrate` already exists for the
pre-accounts format (`sk` + `setupCompleted`).

The project's files live in IndexedDB through lightning-fs (`PgFs`), and the
sync code snapshots and uploads parts of that volume. jsdom has no IndexedDB,
and `fake-indexeddb` is not a dependency.

## Goals / Non-Goals

**Goals:**

- The wallet's state lives in IndexedDB, written and read through one small
  module with no dependency on `PgFs`.
- Migration is lossless under every failure, including two tabs on different
  versions.

**Non-Goals:**

- Protecting the key from same-origin code. Any script on the origin can open
  the same database; that needs the runtime isolation of HOO-1717 step 2.
- Encryption at rest. A wrapping key stored on the same origin protects
  nothing this change does not already, and costs a WebCrypto round trip on
  every signature path.

## Decisions

### A dedicated database, not a file in `PgFs`

The wallet goes to its own database `pg-wallet`, object store `state`, one
record under the key `wallet` holding the serialized state as today's JSON
object. A file under `/.config/` in `PgFs` was rejected: that volume is what
project sync walks and what tab-sync broadcasts, and a keypair must never be
one glob away from an upload. A record per account was rejected: the state is
always read and written whole, and one record keeps the write atomic.

### The keystore sits behind an interface

`utils/wallet/keystore.ts` defines `WalletStore` (`read`, `write`) and its
IndexedDB implementation; `utils/wallet/wallet-storage.ts` takes a
`WalletStore` and the `localStorage` it migrates from. Unit tests pass an
in-memory store, and one that throws. The migration and merge
logic is tested through it, and the real IndexedDB round trip is covered by an
e2e spec, as the project does for `PgFs`.

### Migration order: legacy upgrade, copy, verify, delete

`migrate` runs before `storage.read`:

1. Read `localStorage['wallet']`; nothing there means nothing to do.
2. Upgrade the legacy `sk` format in memory (the existing step).
3. Read IndexedDB. If it holds a wallet, merge: `localStorage`'s accounts
   first, then each IndexedDB account whose public key is not already present,
   with its name suffixed (`Wallet 1 (2)`) on a clash; `localStorage`'s
   `currentIndex`, `state` and `standardName` win. After a first move a
   `localStorage` copy only exists because something wrote it later (a
   session that fell back, a tab on the old bundle), so it is the newer one.
   The whole step runs under a Web Lock, so two tabs never interleave it.
4. Write the result, read it back, compare with `PgCommon.isEqual`.
5. Equal: remove `localStorage['wallet']`, unless its text changed since
   step 1 (an old tab saved meanwhile; the next load merges it).
   Otherwise: log, leave `localStorage` alone, and mark the keystore
   unavailable for this load so reads and writes use `localStorage`.

Comparing public keys rather than whole accounts means a renamed account in
the older tab does not turn into a duplicate.

### Writes are serialized and fall back

`storage.write` chains onto the previous write's promise so that two quick
changes land in order. A write that fails logs and writes the same state to
`localStorage`, so a change is not lost; the next load's migration moves it
back. Losing a key is worse than leaving one in `localStorage`.

### Unreadable copies are set aside

A `localStorage` wallet that is not JSON, or not a wallet's shape, is copied
once to `wallet.unreadable` and left where it is. Without that, the first
fallback write would overwrite what may be the only copy of a key.

### Logging

One logger, `wallet:storage`. Every entry is built from an error's name, its
message only for a `DOMException` or this module's own `Error`s, and account
counts; nothing receives the state object. A `SyntaxError` from `JSON.parse`
quotes the text it failed on, which for a wallet is key bytes. A unit
test runs the failure paths through the memory provider and asserts that no
entry contains any byte sequence of the test keypair.

## Risks / Trade-offs

- [A tab on the old bundle keeps writing `localStorage`] → the next load of
  the new bundle merges it in by public key; nothing is lost, and the entry is
  removed again.
- [IndexedDB evicted under storage pressure while `localStorage` is not] →
  same origin, same eviction bucket in all current browsers; no worse than
  the projects, which already live there.
- [A slow first read delays wallet setup] → one small record; `init` already
  awaits async storage for other classes.

## Migration Plan

Ships as a normal deploy; the migration runs on each user's first load and is
idempotent. Rollback: an older bundle finds no `localStorage['wallet']` and
would create a fresh wallet, so a rollback must ship a reader for the
IndexedDB record first. This is noted in the PR.
