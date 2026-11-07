# Spec Delta

## MODIFIED Requirements

### Requirement: The WASM CLIs say why they cannot use a key held on its own origin

Under the key origin, the `solana`, `spl-token` and `anchor` commands SHALL
have the key page sign the built-in wallet's part of every transaction they
send, at the send step, and SHALL never receive the wallet's secret key bytes.
Under the local provider, where the page holds the key, they sign with it as
before. The signature a command prints for a sent transaction SHALL be the one
the cluster holds. A send whose wallet signature cannot be had (the key page
refuses, the current wallet changed since the run started, or the signature is
not over the transaction's bytes) SHALL end the command with a line saying so
and SHALL send nothing.

A run that asks for offline signing (`--sign-only`) SHALL end before the CLI
starts with one line saying the key is kept on its own origin and naming what
to use instead, because such a run prints signatures without sending them.
Under the local provider it runs as before.

#### Scenario: solana transfer under the key origin

- **WHEN** the key origin is on, the built-in wallet is current and the person
  runs `solana transfer <address> 0.01` on devnet
- **THEN** the key page signs the transaction, the transfer lands, and the
  printed signature resolves on the cluster to that transaction

#### Scenario: spl-token transfer under the key origin

- **WHEN** the key origin is on and the person runs `spl-token transfer` for a
  token account the built-in wallet owns
- **THEN** the transfer lands, signed by the key page

#### Scenario: A transaction with other signers

- **WHEN** a command sends a transaction that the built-in wallet signs together
  with keypairs the CLI makes itself (a nonce account, an IDL buffer)
- **THEN** only the built-in wallet's signature is asked of the signer provider,
  and the other signatures are sent as the CLI made them

#### Scenario: Offline signing under the key origin

- **WHEN** the key origin is on and the person runs `solana transfer <address>
  0.01 --sign-only --blockhash <hash>`
- **THEN** the command ends with the key-origin line and prints no signature

#### Scenario: The wallet changes while a command runs

- **WHEN** the key origin is on and the current wallet changes between the
  start of a command and its send
- **THEN** the command ends with a line naming the wallet it started with, and
  nothing is sent

#### Scenario: The secret key stays out of the app page

- **WHEN** any of these commands runs under the key origin
- **THEN** `PgWallet.getKeypairBytes` is not called
