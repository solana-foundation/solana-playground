# wallet-signing Specification

## Purpose
How the built-in wallet's secret keys are reached, for signing, for the key
file export and for the WASM CLIs, and what project code keeps of them.
Every use goes through one signer provider, so a provider that keeps the keys
out of the page can replace the local one.

## Requirements

### Requirement: Every use of a built-in wallet key goes through the signer provider

The built-in wallet SHALL reach an account's secret key only through its
signer provider: to build the wallet and sign with it, to hand project code
`pg.wallet.keypair`, to export the key file and to give the WASM CLIs their
keypair. The provider SHALL address an account by its public key. When the
build names a key origin, the key-origin provider SHALL be the default;
otherwise the local provider, which keeps the keys in the page, SHALL be.

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

- **WHEN** the key file export or a WASM CLI asks the local provider for an
  account's key bytes
- **THEN** it gets a copy, and changing it leaves the provider's key as it was

#### Scenario: Project code gets the sandbox provider by default

- **WHEN** `run` or `test` executes project code
- **THEN** `pg.wallet` inside it comes from the sandbox provider, and the
  page keeps its own provider for deploy, the CLIs and the key file export

#### Scenario: A build with a key origin uses the key-origin provider

- **WHEN** the app loads from a build that names a key origin
- **THEN** the page's wallets are built by the key-origin provider

### Requirement: Project code keeps pg.wallet.keypair under the local provider

With the local provider, `pg.wallet.keypair` SHALL be the current account's
keypair, so project code that signs with it, the hello-solana tutorial's
`tx.sign(pg.wallet.keypair)` and the native template's test among it, works
as before.

#### Scenario: Project code signs with pg.wallet.keypair

- **WHEN** project code signs a transaction with `pg.wallet.keypair` and runs
  with `run`
- **THEN** the transaction carries a valid signature by the current account

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

#### Scenario: Metaplex with pg.wallet.keypair

- **WHEN** project code uses Metaplex with `keypairIdentity(pg.wallet.keypair)`
  and passes `pg.wallet.keypair` as a signer of an operation, as the
  spl-token-vault tutorial does
- **THEN** the operation's transaction is confirmed with a valid signature by
  the current account, and the key never enters the sandbox

#### Scenario: A v0 transaction signed with pg.wallet.keypair

- **WHEN** project code calls `tx.sign([pg.wallet.keypair])` on a
  `VersionedTransaction` and sends it
- **THEN** the bytes the RPC receives hold a valid signature by the current
  account

#### Scenario: Anchor's payer signs an instruction

- **WHEN** an anchor test passes `provider.wallet.payer` to
  `.signers([...])` or to `sendAndConfirmTransaction`
- **THEN** the transaction is sent with a valid signature by the current
  account

#### Scenario: The native template's test passes (manual)

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

### Requirement: The key page holds the keys on its own origin and signs over postMessage

The key-origin provider SHALL sign every request (a legacy or v0
transaction, a message) by sending the bytes to be signed to the key page, a
hidden frame on the key origin, over a `MessageChannel` set up by a handshake
the page accepts only from that frame at that origin. The key page SHALL
answer only the app origin it was built for. It SHALL offer listing its
public keys, making a key, signing a transaction message,
signing a message, forgetting a key and taking in moved keys. No message
between the page and the key page SHALL carry key bytes, except the one-time
move from the page into the key page.

#### Scenario: The page's wallet signs through the key page

- **WHEN** the built-in wallet signs a legacy or v0 transaction, or a message
- **THEN** the key page returns a signature that verifies against the
  account's public key, and the page holds no key bytes

#### Scenario: Project code signs through the page and the key page

- **WHEN** project code in the sandbox signs with `pg.wallet` or
  `pg.wallet.keypair`
- **THEN** the transaction is signed by the key page

#### Scenario: A frame on another origin is ignored

- **WHEN** a `ready` message reaches the page from a frame or window that is
  not the key page at the key origin
- **THEN** the page hands it no channel

#### Scenario: The key page refuses another app origin

- **WHEN** a page on an origin the key page was not built for frames it and
  sends the handshake
- **THEN** the key page answers nothing

#### Scenario: A message that is a transaction

- **WHEN** a `message` sign request carries bytes that parse as a
  transaction message
- **THEN** the key page refuses it with an error

#### Scenario: No reply carries the key

- **WHEN** the page and the key page exchange messages for creating,
  signing, listing and forgetting
- **THEN** no message carries any account's 64 key bytes

### Requirement: A new account's key is made in the key page

Under the key-origin provider, a new account's key SHALL be made in the key
page and stored there at once, when the dialog opens, so its key file can be
saved before the account exists. A key made for a dialog the user leaves
without adding the account SHALL be forgotten when the dialog closes. The
first account SHALL be made once per page load, shared by the wallet and
Deploy; when it cannot be made, the user SHALL be told once.

#### Scenario: Setup makes the first account

- **WHEN** the user finishes Setup
- **THEN** the key page holds the account's key and the page's record holds
  its name and public key only

#### Scenario: The user closes Add without adding

- **WHEN** the user opens Add, then closes it without adding the account
- **THEN** the key page forgets the key it made for the dialog, and holds no
  new key

#### Scenario: The wallet and Deploy share the first account

- **WHEN** Deploy needs the built-in wallet while the wallet is making its
  first account
- **THEN** both wait on the same account, and the wallet holds one account

#### Scenario: The first account cannot be made

- **WHEN** the key page fails to make the first account
- **THEN** the user is told once that the first account could not be made,
  and the page does not try again until it reloads

### Requirement: Key files are read and written by the key origin

Under the key-origin provider, importing and exporting a key file SHALL be
done by a visible panel of the key page inside the wallet's dialogs. Settings
opens small dialogs for this, "Export keypair" and "Import keypair", each
holding the panel. The file
SHALL be read and the download made on the key origin, and the key bytes
SHALL not reach the app page. While the panel is busy, its dialog SHALL not
be dismissed or submitted, for at most a minute, after which the panel says
the key page stopped answering.

#### Scenario: Export from Settings

- **WHEN** the user presses "Save keypair" in the "Export keypair" dialog that the
  wallet's settings opens
- **THEN** the browser saves `<name>-keypair.json` with the account's 64 key
  bytes, and no message to the app page carries them

#### Scenario: Import a key file

- **WHEN** the user picks a valid key file in the panel of the "Import keypair" dialog
- **THEN** the account is added with the file's public key, and the app page
  never receives the file's bytes

#### Scenario: The dialog stays open while the panel works

- **WHEN** the user presses Escape while the panel reads a picked key file
- **THEN** the dialog stays open, and the import's result reaches it

#### Scenario: Import a file that is not a key

- **WHEN** the user picks a file that is not 64 key bytes in JSON
- **THEN** the panel says the file is not a key file, and no account is added

### Requirement: The WASM CLIs say why they cannot use a key held on its own origin

Under the key-origin provider, asking for the built-in wallet's key bytes for
the `solana`, `spl-token` or `anchor` commands SHALL throw an error saying the
key is kept on its own origin and naming what to use instead.

#### Scenario: solana balance with the built-in wallet

- **WHEN** the built-in wallet is current and a WASM CLI asks for its keypair
- **THEN** the command fails with that error and no key bytes
