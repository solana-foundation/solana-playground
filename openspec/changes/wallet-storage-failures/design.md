# Design

## Context

See proposal.md for why. `wallet-storage.ts` reads and writes the wallet
through `walletStorageWith(store)(local)`; every failure goes to
`reportFailureWith` and nothing returns a status. `wallet.ts`'s `storage.read`
turns an `undefined` read into `defaultState`, whose `state` is `"setup"`, so a
failed read and an empty one are the same. `connect.ts` opens the Setup modal
for `"setup"`. The setup list's "Connect a wallet" step reads only
`useWallet()`. `isStoredWallet` requires every account to be valid.

## Goals / Non-Goals

**Goals:**

- Distinguish "no wallet", "wallet unreadable" and "wallet partly damaged" in
  what storage returns, and let the UI act on that.

**Non-Goals:**

- A UI to recover set-aside accounts.
- Merging across tabs (HOO-2587).

## Decisions

1. **`read` returns a result, not `undefined`.** It becomes
   `{ kind: "wallet", wallet, setAside } | { kind: "none", setAside } | { kind: "unavailable" }`.
   `unavailable` is returned when the store fails with anything but
   `IndexedDB is not available` (absent API) and `localStorage` holds no
   wallet. `wallet.ts` maps `unavailable` to a new `WalletState.state`
   value `"unavailable"`, never persisted (a write of that state is skipped),
   and `current` derives `null` for it.
2. **A write reports whether it landed.** `writeLocal` returns a boolean; the
   queued write resolves `"store" | "local" | "lost"`. On the first `"lost"`
   in a page, `wallet.ts` shows the persistent toast through `PgView.setToast`
   with `duration: "persistent"`, the pattern of
   `views/flow/lessons/SaveFailedToast.tsx`.
3. **Damaged accounts are filtered, not rejected.** `isStoredWallet` checks
   the wallet's shape and at least one valid account; a store record that
   fails it is set aside whole, as one entry of the set-aside record, and
   reads as no wallet with the set-aside notice (Try again could never have
   read it). If it cannot be set aside and `localStorage` holds no wallet,
   the read stays `unavailable`. A `partition` splits
   accounts into valid and damaged, and `currentIndex` is remapped (to 0 when
   the current one was damaged). The damaged accounts are written under a
   second key, `set-aside`, in the same object store, appended to what is
   there, inside the same lock. They never go to `localStorage`, since they
   may hold key bytes.
4. **Unavailable in the UI.** `connect.ts` throws a marked
   `WalletUnavailableError` for `"unavailable"`. The setup list's wallet step
   gets a `warn` status with the label "Wallet unavailable" when
   `state === "unavailable"`; picking it runs `PgWallet.reload()` (re-read
   through storage) and records `setup_wallet_retried` with the outcome.
   The account row's wallet toggle shows the same toast as other connect
   failures.
5. **Persistence.** After the first `"store"` write in a page,
   `navigator.storage?.persist?.()` is called once; its answer is logged at
   info level.
6. **Keystore tests.** `fake-indexeddb` is a devDependency, imported in the
   in-source block's `beforeAll`; each test stubs `indexedDB` with a fresh
   `IDBFactory` through `vi.stubGlobal`, so `setupTests.ts` stays as it is.
   This reverses the archived `wallet-keystore` design's "not a dependency"
   line, on Slava's decision of 4 Nov.

## Risks / Trade-offs

- [The unavailable state hides a wallet the user could have recreated] →
  Try again is offered, and a browser without IndexedDB still gets Setup.
- [Set-aside records grow] → they only grow when accounts are damaged, which
  is rare; a later tool can clear them.
