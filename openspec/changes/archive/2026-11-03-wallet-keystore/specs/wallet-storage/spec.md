## ADDED Requirements

### Requirement: The wallet is not persisted in localStorage

The built-in wallet's state, including every account's secret key, SHALL be
persisted in IndexedDB, in a database used only by the wallet. Once IndexedDB
is available, no `localStorage` key SHALL hold a wallet secret key.

#### Scenario: A new wallet is created

- **WHEN** a user with no stored wallet lets the built-in wallet create an
  account
- **THEN** the account and its keypair are stored in the wallet's IndexedDB
  database
- **AND** `localStorage` has no `wallet` key

#### Scenario: The wallet survives a reload

- **WHEN** a user with a wallet in IndexedDB reloads the page
- **THEN** the same accounts, names, current account and connection state are
  restored

### Requirement: An existing localStorage wallet is migrated without loss

On load, a wallet found in `localStorage['wallet']`, in the current or the
legacy single-key format, SHALL be copied to IndexedDB, read back and
compared, and the `localStorage` entry SHALL be removed only after the copy
reads back equal. If the copy fails or differs, the `localStorage` entry
SHALL stay and the wallet SHALL load from it.

#### Scenario: A wallet in localStorage moves to IndexedDB

- **WHEN** a user whose wallet is in `localStorage['wallet']` loads the app
- **THEN** the wallet's accounts are in IndexedDB with the same keypairs and
  names
- **AND** `localStorage['wallet']` is gone
- **AND** the current account is the one that was current before

#### Scenario: The copy fails

- **WHEN** writing the wallet to IndexedDB fails, or reading it back differs
  from what was written
- **THEN** `localStorage['wallet']` is left as it was
- **AND** the wallet loads from it with every account

#### Scenario: Both stores hold a wallet

- **WHEN** IndexedDB already holds a wallet and `localStorage['wallet']` also
  holds one (for example, written by a tab still running the previous
  version)
- **THEN** the stored wallet holds every account from both, one per public
  key, IndexedDB's accounts first
- **AND** an account only `localStorage` held keeps its name, renamed with a
  numeric suffix if the name is taken

### Requirement: The wallet works when IndexedDB is unavailable

If the wallet's IndexedDB database cannot be opened, the wallet SHALL read
and write `localStorage['wallet']` as before, and SHALL record the failure
through the logger with `report: true`.

#### Scenario: IndexedDB is blocked

- **WHEN** opening the wallet's IndexedDB database fails
- **THEN** the wallet loads from and saves to `localStorage['wallet']`
- **AND** one error is logged under the wallet's logger namespace

#### Scenario: A save to IndexedDB fails

- **WHEN** the wallet changes and writing it to IndexedDB fails
- **THEN** the wallet is written to `localStorage['wallet']` instead, so the
  change is not lost on reload
- **AND** the next load migrates it back to IndexedDB

### Requirement: Key material never leaves the wallet store

No log entry, error report or network request made by wallet storage or its
migration SHALL contain a secret key, in any encoding. Logged failures carry
only an error's name and message and counts of accounts.

#### Scenario: A failing migration is logged

- **WHEN** the migration fails and logs the failure
- **THEN** the log entry's message and context contain no keypair bytes
