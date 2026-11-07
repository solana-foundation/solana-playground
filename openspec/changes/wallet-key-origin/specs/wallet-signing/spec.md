## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: The key page holds the keys on its own origin and signs over postMessage

The key-origin provider SHALL sign every request (a legacy or v0
transaction, a message) by sending the bytes to be signed to the key page, a
hidden frame on the key origin, over a `MessageChannel` set up by a handshake
the page accepts only from that frame at that origin. The key page SHALL
answer only the app origin it was built for. It SHALL offer listing its
public keys, making a key, keeping a made key, signing a transaction message,
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
page and stored there when the account is added. A key made for a dialog the
user leaves without adding the account SHALL not be stored.

#### Scenario: Setup makes the first account

- **WHEN** the user finishes Setup
- **THEN** the key page holds the account's key and the page's record holds
  its name and public key only

#### Scenario: The user closes Add without adding

- **WHEN** the user opens Add, then closes it
- **THEN** the key page stores no new key

### Requirement: Key files are read and written by the key origin

Under the key-origin provider, importing and exporting a key file SHALL be
done by a visible panel of the key page inside the wallet's dialogs: the file
SHALL be read and the download made on the key origin, and the key bytes
SHALL not reach the app page.

#### Scenario: Export from Settings

- **WHEN** the user presses "Download key file" in the wallet's settings
- **THEN** the browser saves `<name>-keypair.json` with the account's 64 key
  bytes, and no message to the app page carries them

#### Scenario: Import a key file

- **WHEN** the user picks a valid key file in the import panel
- **THEN** the account is added with the file's public key, and the app page
  never receives the file's bytes

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
