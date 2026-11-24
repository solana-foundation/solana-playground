## ADDED Requirements

### Requirement: Every use of a built-in wallet key goes through the signer provider

The built-in wallet SHALL reach an account's secret key only through its
signer provider: to build the wallet and sign with it, to hand project code
`pg.wallet.keypair`, to export the key file and to give the WASM CLIs their
keypair. The provider SHALL address an account by its public key. The local
provider, which keeps the keys in the page, SHALL be the default.

#### Scenario: The local provider signs for an account

- **WHEN** the wallet is built for an account the local provider holds
- **THEN** its legacy and v0 transactions and its messages are signed with
  that account's key

#### Scenario: An account the provider holds no key for

- **WHEN** the wallet is built, or a key is asked for, by a public key the
  provider holds no key for
- **THEN** the provider throws an error naming the public key and no other
  data

#### Scenario: The key bytes handed out are a copy

- **WHEN** the key file export or a WASM CLI asks for an account's key bytes
- **THEN** it gets a copy, and changing it leaves the provider's key as it was

### Requirement: Project code keeps pg.wallet.keypair under the local provider

With the local provider, `pg.wallet.keypair` SHALL be the current account's
keypair, so project code that signs with it, the hello-solana tutorial's
`tx.sign(pg.wallet.keypair)` and the native template's test among it, works
as before.

#### Scenario: Project code signs with pg.wallet.keypair

- **WHEN** project code signs a transaction with `pg.wallet.keypair` and runs
  with `run`
- **THEN** the transaction carries a valid signature by the current account
