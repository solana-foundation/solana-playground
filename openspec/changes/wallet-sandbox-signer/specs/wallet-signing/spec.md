# Spec Delta

## MODIFIED Requirements

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

#### Scenario: Project code gets the sandbox provider by default

- **WHEN** `run` or `test` executes project code
- **THEN** `pg.wallet` inside it comes from the sandbox provider, and the
  page keeps the local provider for deploy, the CLIs and the key file export

## ADDED Requirements

### Requirement: The sandbox provider signs over postMessage and never holds a key

The sandbox provider SHALL sign every request (a legacy or v0 transaction, a
batch of them, a message, or the bytes behind `tx.sign(pg.wallet.keypair)`)
by asking the page. The page SHALL sign with the local provider and return
only the signatures or the signed transactions. No message from the page to
the sandbox SHALL carry secret key bytes. Asked for an account's key bytes,
the sandbox provider SHALL throw.

#### Scenario: pg.wallet signs from the sandbox

- **WHEN** project code calls `pg.wallet.signTransaction`,
  `pg.wallet.signAllTransactions` or `pg.wallet.signMessage`
- **THEN** each transaction carries a valid signature by the current
  account, and the message signature verifies against its public key

#### Scenario: No message to the sandbox carries the key

- **WHEN** a script that signs a transaction, a v0 transaction and a message
  runs, and every message the page posts to the sandbox is recorded
- **THEN** none of them contains the account's 32 private key bytes, in any
  form

#### Scenario: A sign request for an account the page does not hold

- **WHEN** the sandbox asks the page to sign for a public key the page holds
  no key for
- **THEN** the request is refused with an error naming the public key, and
  the project code's call rejects with it

### Requirement: pg.wallet.keypair signs but yields no key bytes in the sandbox

In the sandbox, `pg.wallet.keypair` SHALL be keypair-shaped: an instance of
web3.js `Keypair` with the current account's public key. Used as a signer
with web3.js or anchor, it SHALL produce a valid signature by the time the
transaction is sent or simulated. Reading `secretKey` SHALL throw an error
that names `pg.wallet.signMessage` and `pg.wallet.signTransaction`.

#### Scenario: The hello-solana client signs with tx.sign

- **WHEN** the hello-solana tutorial's client runs `tx.sign(pg.wallet.keypair)`
  and then `pg.connection.sendRawTransaction(tx.serialize())`
- **THEN** the transaction lands, and its signature is the current account's

#### Scenario: sendAndConfirmTransaction with pg.wallet.keypair

- **WHEN** project code calls
  `web3.sendAndConfirmTransaction(pg.connection, tx, [pg.wallet.keypair])`
- **THEN** the transaction is confirmed with a valid signature by the
  current account

#### Scenario: A v0 transaction signed with pg.wallet.keypair

- **WHEN** project code calls `tx.sign([pg.wallet.keypair])` on a
  `VersionedTransaction` and sends it
- **THEN** the transaction lands with a valid signature by the current
  account

#### Scenario: Anchor's payer signs an instruction

- **WHEN** an anchor test passes `provider.wallet.payer` to
  `.signers([...])` or to `sendAndConfirmTransaction`
- **THEN** the transaction is sent with a valid signature by the current
  account

#### Scenario: The native template's test passes

- **WHEN** the native template's default test, which signs with
  `pg.wallet.keypair`, runs with `test` against a deployed program
- **THEN** it passes

#### Scenario: Reading the secret key

- **WHEN** project code reads `pg.wallet.keypair.secretKey`
- **THEN** it gets an error naming `pg.wallet.signMessage` and
  `pg.wallet.signTransaction`, and no bytes

#### Scenario: Another signer alongside the wallet

- **WHEN** project code calls `tx.sign(pg.wallet.keypair, newAccount)` with a
  keypair it generated itself
- **THEN** both signatures in the sent transaction are valid
