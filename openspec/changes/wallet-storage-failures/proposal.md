# Proposal

## Why

The wallet's move to IndexedDB (HOO-1717, archived as `wallet-keystore`)
handles every storage failure by logging it. The user is told nothing: a
wallet that could not be saved anywhere looks saved until the next reload
loses it; a wallet that cannot be read looks like no wallet, so the app offers
to create a new one; and one damaged account makes the whole stored wallet
unreadable. Slava put these follow-ups into the same PR as the move
(SF#106, 4 Nov).

## What Changes

- When a wallet change could not be saved in either store, the user sees one
  persistent notice per page load saying the change is kept only until
  reload.
- A wallet that exists but cannot be read (IndexedDB fails for a reason other
  than not existing in this browser, and `localStorage` holds no wallet) is
  shown as unavailable, with a way to try again, instead of the Setup flow
  that would make a new wallet.
- A stored wallet with some damaged accounts loads its valid accounts. The
  damaged ones are kept aside in the wallet's own IndexedDB database, never
  in `localStorage`, and the user is told once.
- After the first successful save to IndexedDB, the app asks the browser to
  keep the wallet's storage persistent.
- The keystore gets unit tests against an in-memory IndexedDB
  (`fake-indexeddb`, a new devDependency; it is not in the bundle).
- Telemetry: one event, `setup_wallet_retried`, when the user tries again on
  an unavailable wallet, with the outcome.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wallet-storage`: failures are shown to the user, an unreadable wallet is
  no longer treated as no wallet, damaged accounts no longer hide valid ones,
  and storage persistence is requested.

## Impact

- Code: `client-v2/src/utils/wallet/` (`wallet-storage.ts`, `keystore.ts`,
  `wallet.ts`, `types.ts`), `client-v2/src/commands/connect/connect.ts`,
  `client-v2/src/widgets/setup-list/` (the Connect a wallet step and its
  telemetry), and a notice component for the save failure.
- Dependencies: `fake-indexeddb` as a devDependency.
- Out of scope: merging the wallet across two tabs (HOO-2587); a UI to
  recover set-aside accounts (they stay in the database for a later tool).
