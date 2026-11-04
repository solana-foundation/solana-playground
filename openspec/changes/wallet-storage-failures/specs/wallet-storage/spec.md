## MODIFIED Requirements

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

## ADDED Requirements

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

#### Scenario: A browser without IndexedDB gets Setup

- **WHEN** IndexedDB does not exist in this browser and `localStorage` holds
  no wallet
- **THEN** the Setup flow is offered as before, and the new wallet is saved
  to `localStorage`

### Requirement: A damaged account does not hide the others

A stored wallet, in IndexedDB or in `localStorage`, in which some accounts
are damaged (not a name and a 64-byte keypair) SHALL load with its valid
accounts. The damaged accounts SHALL be kept aside in the wallet's IndexedDB
database, never in `localStorage`, and no later write SHALL remove them. The
user SHALL be told once per page load with the notice "Some wallet accounts
could not be read and were set aside." A wallet with no valid account is
unreadable as a whole, as before.

#### Scenario: One of three accounts is damaged

- **WHEN** the stored wallet has three accounts and one has a 10-byte keypair
- **THEN** the wallet loads with the other two
- **AND** the damaged account is in the wallet's database under the set-aside
  record
- **AND** the notice is shown once

#### Scenario: The current account is the damaged one

- **WHEN** the current account is the damaged one
- **THEN** the first valid account becomes current

### Requirement: The wallet's storage is kept persistent

After the first successful write of the wallet to IndexedDB in a page load,
the app SHALL ask the browser to keep the origin's storage persistent, and
SHALL log the answer without reporting it.

#### Scenario: Persistence is requested once

- **WHEN** the wallet is saved to IndexedDB twice in one page load
- **THEN** the browser is asked to persist storage once
