## Why

The built-in wallet keeps its whole state, every account's 64-byte ed25519
keypair included, as plain JSON in `localStorage['wallet']` (HOO-1717). That
key is the single most-read storage key on the origin: DevTools, any
extension with page access and any script that runs `localStorage` see it in
one call. This change moves the wallet out of `localStorage` without losing a
single existing key. It is step 1 of HOO-1717; keeping the key from project
code (step 2) is a separate decision.

## What Changes

- The wallet's persisted state (accounts with their keypairs, the current
  index, the connection state, the Wallet Standard name) moves to a dedicated
  IndexedDB database, `pg-wallet`, that no other module opens.
- On load, a wallet found in `localStorage['wallet']` is migrated: the
  legacy single-key format is upgraded as before, the state is written to
  IndexedDB, read back and compared, and only then is the `localStorage` entry
  removed. When IndexedDB already holds a wallet, the two are merged by public
  key, so a key present in either survives.
- If IndexedDB cannot be opened (blocked storage, some private modes), the
  wallet keeps working from `localStorage` exactly as today, and the failure
  is logged without any key material.
- No key material is ever logged, reported or sent to the server; the
  migration logs only counts and error names.
- No telemetry events are added, renamed or removed (no slice under
  `features/` or `widgets/` changes).

## Capabilities

### New Capabilities

- `wallet-storage`: where the built-in wallet's state is persisted, how an
  existing wallet is migrated, and what happens when the store is unavailable.

### Modified Capabilities

None.

## Impact

- Code: `client-v2/src/utils/wallet/` (storage, migration, a new keystore
  module and its tests). `updatable` already accepts async storage, so
  nothing else changes. `client/` and `server/` are untouched.
- User-visible: nothing changes on screen. Users' existing wallets come
  across on their first load after the deploy; clearing site data removes the
  wallet together with projects, as it does today.
- Out of scope: keeping the key from project code. `pg.wallet.keypair` is
  still handed to the same-origin runtime iframe, so a script the user runs
  can still read the key. That is HOO-1717 step 2 (runtime isolation), held
  for a decision on whether `tx.sign(pg.wallet.keypair)` may break. Also out
  of scope: encrypting the key at rest, passphrases, and external wallets
  (HOO-1615, HOO-1616, HOO-1617).
