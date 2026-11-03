# Tasks

All tasks belong to HOO-1717 and land in one PR; they run in order.

## 1. Keystore

- [ ] 1.1 Add `client-v2/src/utils/wallet/keystore.ts`: read, write and
      remove the serialized wallet over an injectable `{ get, put, delete }`
      backend, with an IndexedDB backend for database `pg-wallet`, store
      `state`, key `wallet`; verify with unit tests over an in-memory backend
      (round trip, missing record reads `null`). (HOO-1717)

## 2. Migration and storage

- [ ] 2.1 Replace `storage` in `wallet.ts` with the keystore, serialized
      writes and the `localStorage` fallback on an unavailable or failing
      store; verify with unit tests for each scenario of "The wallet works
      when IndexedDB is unavailable". Depends on 1.1. (HOO-1717)
- [ ] 2.2 Extend `migrate` to copy, verify, merge by public key and then
      remove `localStorage['wallet']`; verify with unit tests for every
      scenario of "An existing localStorage wallet is migrated without loss",
      the legacy `sk` format included. Depends on 2.1. (HOO-1717)
- [ ] 2.3 Log failures under `wallet:storage` without key material; verify
      with a unit test that runs the failure paths through the memory provider
      and finds no keypair bytes in any entry. Depends on 2.2. (HOO-1717)

## 3. Browser check

- [ ] 3.1 Add an e2e spec that seeds `localStorage['wallet']`, loads the app,
      and asserts the same public key is shown, the IndexedDB record holds it
      and `localStorage` has no `wallet` key. Depends on 2.2. (HOO-1717)
