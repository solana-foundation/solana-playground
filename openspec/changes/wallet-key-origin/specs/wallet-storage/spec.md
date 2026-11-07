## ADDED Requirements

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
again. The move SHALL run under the wallet's cross-tab lock.

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
