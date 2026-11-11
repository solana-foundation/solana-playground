# wallet-storage Specification

## Purpose
Where the built-in wallet's state, its secret keys included, is persisted: its own IndexedDB database rather than `localStorage`, how a wallet still in `localStorage` moves there without loss, and what happens when IndexedDB is unavailable.

## Requirements

### Requirement: The wallet is not persisted in localStorage

The built-in wallet's state, including every account's secret key, SHALL be
persisted in IndexedDB, in a database used only by the wallet. While
IndexedDB works, no `localStorage` key SHALL hold a wallet secret key, with
three exceptions this spec describes: the fallback when IndexedDB fails, an
unreadable copy set aside, which nothing removes, and a save still waiting
for the cross-tab lock when the page is hidden, until it lands or the next
load moves it.

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

#### Scenario: The tab closes before a save lands

- **WHEN** the wallet changes (for example, a new account) while another tab
  holds the wallet's lock, and the page is hidden before the save runs
- **THEN** the pending wallet is written to `localStorage['wallet']`
- **AND** the next load moves it into IndexedDB, so the new account's key is
  not lost
- **AND** if the save lands in IndexedDB first, the `localStorage` copy is
  removed

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

#### Scenario: A legacy single-key wallet moves to IndexedDB

- **WHEN** `localStorage['wallet']` holds the pre-accounts format (`sk`,
  `setupCompleted`, `connected`)
- **THEN** IndexedDB holds it as one account named `Wallet 1` with the same
  keypair
- **AND** `localStorage['wallet']` is gone

#### Scenario: Two tabs load at once

- **WHEN** two tabs load while `localStorage['wallet']` still holds a wallet
- **THEN** one tab moves it at a time, and no account either tab saves is
  overwritten by the other's move

#### Scenario: A localStorage wallet cannot be read

- **WHEN** `localStorage['wallet']` is not valid JSON or not a wallet's shape
- **THEN** it is left in place and copied once to `localStorage['wallet.unreadable']`,
  which no later write replaces
- **AND** the wallet loads from IndexedDB

#### Scenario: The copy fails

- **WHEN** writing the wallet to IndexedDB fails, or reading it back differs
  from what was written
- **THEN** `localStorage['wallet']` keeps every account's key and name;
  each account may gain its `publicKey`, read from its key
- **AND** the wallet loads from it with every account
- **AND** under the key-origin provider, once the key page holds the keys,
  `localStorage['wallet']` keeps every account's name and public key and no
  key bytes instead

#### Scenario: Both stores hold a wallet

- **WHEN** IndexedDB already holds a wallet and `localStorage['wallet']` also
  holds one (for example, written by a tab still running the previous
  version)
- **THEN** the stored wallet holds every account from both, one per public
  key, `localStorage`'s accounts first, since a copy there is the newer one
- **AND** `localStorage`'s current account and connection state win
- **AND** an account only IndexedDB held keeps its name, renamed with a
  numeric suffix if the name is taken

### Requirement: The wallet works when IndexedDB is unavailable

If the wallet's IndexedDB database cannot be opened, the wallet SHALL read
and write `localStorage['wallet']` as before, and SHALL record the failure
through the logger with `report: true`. A wallet change that could not be
saved in IndexedDB nor in `localStorage` SHALL be shown to the user, once per
page load, as a persistent notice reading "Your wallet could not be saved.
Changes are kept until you reload; export your keypair to keep it."

#### Scenario: IndexedDB is blocked

- **WHEN** opening the wallet's IndexedDB database fails, or does not answer
  within 5 seconds
- **THEN** the wallet loads from and saves to `localStorage['wallet']`
- **AND** one error is logged under the wallet's logger namespace

#### Scenario: localStorage refuses to be read

- **WHEN** reading `localStorage` throws (a sandboxed or blocked origin)
- **THEN** the wallet loads from IndexedDB
- **AND** one error is logged under the wallet's logger namespace

#### Scenario: The cross-tab lock cannot be taken

- **WHEN** the browser refuses the wallet's Web Lock
- **THEN** the move and the saves run without it
- **AND** one error is logged for the page, however many saves follow

#### Scenario: A save to IndexedDB fails

- **WHEN** the wallet changes and writing it to IndexedDB fails
- **THEN** the wallet is written to `localStorage['wallet']` instead, so the
  change is not lost on reload
- **AND** the next load migrates it back to IndexedDB

#### Scenario: Neither store saves the wallet

- **WHEN** the wallet changes, writing it to IndexedDB fails and writing it
  to `localStorage` fails too
- **THEN** the notice "Your wallet could not be saved." is shown once
- **AND** a second failed save in the same page load shows no second notice
- **AND** while the wallet has no account, a failed save shows no notice,
  since nothing can be lost

### Requirement: Key material never leaves the wallet store

No log entry, error report or network request made by wallet storage or its
migration SHALL contain a secret key, in any encoding. Logged failures carry
only an error's name, its message where the browser fixes it (a
`DOMException`) or this module wrote it, and counts of accounts.

#### Scenario: A failing migration is logged

- **WHEN** the migration fails and logs the failure
- **THEN** the log entry's message and context contain no keypair bytes

#### Scenario: A truncated localStorage wallet is logged

- **WHEN** `localStorage['wallet']` is cut off inside a keypair and the
  `JSON.parse` error is logged
- **THEN** the entry carries the error's name only, not the message that
  quotes the text

### Requirement: An unreadable wallet is not offered as a new one

When the wallet's IndexedDB database fails for a reason other than IndexedDB
not existing in this browser, and `localStorage` holds no wallet, the wallet
SHALL be in an `unavailable` state, not the Setup state. In that state the
setup list's "Connect a wallet" step SHALL show the warning status with the
text "Wallet unavailable" and a "Try again" action that reads the wallet
again, and connecting SHALL not open the Setup flow. A try again SHALL be
recorded as `setup_wallet_retried` with `outcome` `loaded` (the wallet was
read) or `unavailable` (it still could not be).

#### Scenario: The store fails and nothing is in localStorage

- **WHEN** reading the wallet's IndexedDB database fails with an error other
  than IndexedDB being absent, and `localStorage['wallet']` is empty
- **THEN** the "Connect a wallet" step shows "Wallet unavailable" with the
  warning status
- **AND** no Setup dialog opens, and no new wallet is created

#### Scenario: Try again reads the wallet

- **WHEN** the wallet is unavailable and the store answers again
- **AND** the user picks "Try again"
- **THEN** the stored wallet loads and the step shows its address
- **AND** `setup_wallet_retried` is recorded with `outcome: loaded`

#### Scenario: connect reads an unavailable wallet again

- **WHEN** the wallet is unavailable and the setup list is dismissed or
  completed, so its "Try again" is not shown
- **AND** the user runs `connect`
- **THEN** the wallet is read again; while it still cannot be read, `connect`
  fails with "Run connect to try again", and once the store answers it
  prints "Wallet loaded."

#### Scenario: A browser without IndexedDB gets Setup

- **WHEN** IndexedDB does not exist in this browser and `localStorage` holds
  no wallet
- **THEN** the Setup flow is offered as before, and the new wallet is saved
  to `localStorage`

### Requirement: A damaged account does not hide the others

A stored wallet, in IndexedDB or in `localStorage`, in which some accounts
are damaged (not a name with a valid `publicKey` or a 64-byte keypair, or
the two disagree) SHALL load with its valid
accounts. The damaged accounts SHALL be kept aside in the wallet's IndexedDB
database, and no later write SHALL remove them. The
user SHALL be told once per page load with the notice "Some wallet accounts
could not be read and were set aside." A record in IndexedDB that is not a
wallet's shape, a wallet with no valid account among them, SHALL be set aside
whole in the same set-aside record and read as no
wallet, with the same notice. A `localStorage` copy of the wrong shape is
kept aside in `localStorage`, as before.

They SHALL go to `localStorage` only when the store refuses the set-aside
write: then the original text that held them (the `localStorage` copy, or else
the IndexedDB record) SHALL be kept in `localStorage['wallet.unreadable']`,
where the first copy kept is never replaced, rather than lost.

#### Scenario: One of three accounts is damaged

- **WHEN** the stored wallet has three accounts and one has a 10-byte keypair
- **THEN** the wallet loads with the other two
- **AND** the damaged account is in the wallet's database under the set-aside
  record
- **AND** the notice is shown once

#### Scenario: The current account is the damaged one

- **WHEN** the current account is the damaged one
- **THEN** the first valid account becomes current

#### Scenario: The stored record is not a wallet

- **WHEN** the wallet's IndexedDB record is not a wallet's shape, or has no
  valid account, and `localStorage` holds no wallet
- **THEN** the whole record is in the wallet's database under the set-aside
  record
- **AND** the wallet reads as no wallet, so the Setup flow is offered
- **AND** the notice is shown once

#### Scenario: The store refuses the set-aside write

- **WHEN** a stored wallet has a damaged account, or the IndexedDB record is
  not a wallet's shape, and writing the set-aside record fails
- **THEN** the text that held them is in `localStorage['wallet.unreadable']`
- **AND** a copy already kept there is not replaced

#### Scenario: The stored record is not a wallet, and localStorage holds one

- **WHEN** the wallet's IndexedDB record is not a wallet's shape and
  `localStorage` holds a wallet
- **THEN** the record is set aside whole and the `localStorage` wallet moves
  into IndexedDB in its place

### Requirement: The wallet's storage is kept persistent

After the first successful write of the wallet to IndexedDB in a page load,
the app SHALL ask the browser to keep the origin's storage persistent, and
SHALL log the answer without reporting it.

#### Scenario: Persistence is requested once

- **WHEN** the wallet is saved to IndexedDB twice in one page load
- **THEN** the browser is asked to persist storage once

### Requirement: The app's origin holds no key bytes under the key-origin provider

Under the key-origin provider, the page's wallet record SHALL store each
account as its name and public key. No IndexedDB record and no `localStorage`
key of the app's origin SHALL hold an account's key bytes, in any encoding,
once the move is done.

#### Scenario: A new wallet under the key-origin provider

- **WHEN** a user with no wallet finishes Setup
- **THEN** the app origin's `pg-wallet` record and `localStorage` hold the
  account's name and public key, and no key bytes

#### Scenario: The wallet survives a reload

- **WHEN** the page reloads after the move
- **THEN** the same accounts load, and each signs through the key page

### Requirement: Keys in the page move to the key origin without loss

On the first load under the key-origin provider, every key in the page's
record, in `localStorage['wallet']` and in the set-aside copies SHALL be sent
to the key page, stored there and read back. The page SHALL drop its key bytes
only after the key page has confirmed every account's public key. If any step
fails, the page's record SHALL stay as it was and the next load SHALL try
again. While a copy on the app's origin still holds key bytes the key page
already confirmed, the wallet SHALL be `unavailable` and the next read SHALL
finish the move. A `localStorage` wallet the store refuses SHALL be rewritten
in `localStorage` without key bytes and SHALL load from there. The move SHALL
run under the wallet's cross-tab lock.

#### Scenario: Three accounts move

- **WHEN** a page with three accounts in `pg-wallet` loads under the
  key-origin provider for the first time
- **THEN** the key page holds the three keys, the page's record holds the
  three names and public keys and no key bytes, and the current account is
  unchanged

#### Scenario: The key page does not confirm one key

- **WHEN** the key page's reply lacks one of the moved public keys
- **THEN** the page's record keeps every key, and the failure is logged
  without key material

#### Scenario: The store refuses the record without keys

- **WHEN** the key page confirms every key, but the store refuses the record
  without key bytes
- **THEN** the wallet is `unavailable`, the store keeps its record, and the
  next read that the store accepts loads the wallet without key bytes

#### Scenario: The store refuses a localStorage wallet

- **WHEN** the key page confirms the keys of a `localStorage` wallet, but the
  store refuses the copy
- **THEN** `localStorage['wallet']` is rewritten without key bytes, and the
  wallet loads from it

#### Scenario: Two tabs load at once

- **WHEN** two tabs load under the key-origin provider for the first time
- **THEN** the keys move once, and both tabs load the same accounts

### Requirement: An unreachable key origin reads as unavailable

If the key page does not answer the handshake within the time limit, or its
protocol version differs, the wallet SHALL be in the `unavailable` state, not
Setup, and SHALL write nothing to the page's record.

#### Scenario: The key origin is blocked

- **WHEN** the key page never loads
- **THEN** the wallet is `unavailable`, its "Try again" asks the key page
  again, and the page's record is unchanged

#### Scenario: The page's record names a key the key page lacks

- **WHEN** an account in the page's record has no key in the key page
- **THEN** signing with it fails with an error naming its public key, and the
  account is not removed

### Requirement: Remove forgets an account's key only once the record is stored

Removing an account SHALL first store the page's record without it, and only
then ask the signer provider to forget its key. A record that could not be
stored SHALL keep the key, and the user SHALL be told the save failed. A record
that landed in `localStorage` while the store may still list the account
counts as not stored, since the next read merges the account back. A key that
could not be forgotten SHALL be reported, and the user SHALL be told.

#### Scenario: Remove stores the record, then forgets the key

- **WHEN** the user removes an account and the record without it is stored
- **THEN** the key page forgets the account's key

#### Scenario: The record without the account cannot be stored

- **WHEN** the user removes an account and the record cannot be stored
- **THEN** the key is kept, and the user is told the save failed

#### Scenario: The record lands only in localStorage while the store lists the account

- **WHEN** the user removes an account, the store refuses the record, and
  `localStorage` takes it
- **THEN** the key is kept, and the user is told the save failed

#### Scenario: The key cannot be forgotten

- **WHEN** the record is stored but the key page fails to forget the key
- **THEN** the failure is logged without key material, and the user is told
  the removed account's key is still stored in this browser

### Requirement: A keyless record under the local provider reads as unavailable

A build with no key origin (the `local` provider) that reads a record whose
accounts hold no key bytes, as one written under the key-origin provider
does, SHALL put the wallet in the `unavailable` state and SHALL write nothing
to the record.

#### Scenario: The key origin setting is dropped after the move

- **WHEN** a build without `REACT_APP_WALLET_KEY_ORIGIN` loads a record of
  names and public keys only
- **THEN** the wallet is `unavailable`, not Setup, and the record is
  unchanged
