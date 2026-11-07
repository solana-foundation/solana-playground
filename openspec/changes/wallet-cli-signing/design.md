# Design

## Context

The WASM CLIs take the wallet's 64 key bytes from `PgWallet.getKeypairBytes`
(`wasm/utils/solana-playground-utils/src/js.rs`) and build a `Keypair`:
`solana-cli/src/wasm.rs` (default signer), `spl-token-cli/src/config.rs`
(default signer and fee payer), `anchor-cli/src/utils.rs` (`get_keypair`).
Solana's `Signer` trait is synchronous. The key page answers over postMessage,
so a signature from it is only available asynchronously.

Every transaction those CLIs send goes through `WasmClient` in
`wasm/solana-client`: `send_transaction_with_config`, which
`send_and_confirm_*` calls. That method is `async`.

The key page signs `kind: "transaction"` requests over raw message bytes
(`key-origin/frame/handler.ts`). It refuses `kind: "message"` bytes that parse
as a transaction, so the CLIs must ask for a transaction signature.

## Goals / Non-Goals

**Goals:**
- One place where the wallet's real signature is obtained: the send step.
- Same code path under both signer providers in client-v2.
- Upstream `client/`, which shares the WASM packages and has no new methods,
  keeps working unchanged.

**Non-Goals:**
- An asynchronous `Signer` trait or changes to every `try_sign` call site.
- Cross-origin isolation (SharedArrayBuffer and `Atomics.wait`) to make the
  call synchronous.
- Swapping signatures in JS after the CLI is done (rejected by Slava, 7 Nov:
  the CLI would hold and print a wrong signature).

## Decisions

### A marker signature, filled at send

`PgWalletSigner` (in `solana-playground-utils`) implements `Signer`. Its
`pubkey()` is the wallet's public key. Its `try_sign_message` returns a fixed
marker, 64 bytes of `0xff`. It must not be `Signature::default()`, because
`Transaction::try_sign` checks `is_signed()` against the default signature and
would fail. `is_interactive()` is false.

`solana-client` gets a small deferred-signing registry: `set_deferred_signer`
takes a public key and an async function from message bytes to a `Signature`.
`send_transaction_with_config` checks the transaction's required signer keys.
Each slot that holds the registered key and the marker is filled with the
awaited signature over `transaction.message_data()`. Slots of other signers
are not touched. When nothing is registered, or no slot holds the marker,
sending is unchanged.

The registry is a `thread_local` `RefCell`, because WASM on the page has one
thread. Each CLI entry sets it at the start of a run and clears it at the end,
so a run that panics cannot leave a signer for the next CLI.

*Alternatives:* fill the marker in each CLI before every `send_*` call (about
40 call sites across three crates, easy to miss one). Or have `solana-client`
depend on `solana-playground-utils` (it is a general RPC client and should not
know the Playground). The registry keeps `solana-client` generic: it receives a
function.

### Simulation and fee checks

`simulate_transaction` is sent with `sig_verify: false` by default, so a marker
passes. Fee lookups take the message, not signatures. The implementation
checks every `simulate_transaction` caller in the three crates for
`sig_verify: true`. Any found are filled the same way, before the request.

### JS side

`PgWallet.getPublicKeyBytes()` returns the current built-in wallet's 32 public
key bytes. It throws the same "Not connected" and "Not Playground Wallet"
errors as `getKeypairBytes`.

`PgWallet.signTransactionMessage(message: Uint8Array): Promise<Uint8Array>`
builds a legacy `Transaction` with `Transaction.populate(Message.from(message))`
and asks the current wallet to `signTransaction`. It returns the current
wallet's signature from the result. This reuses the providers' existing
transaction path: the local `Keypair` and the key page both sign
`kind: "transaction"`. No new protocol message is added.

### Feature detection for upstream `client/`

Before choosing a signer, the Rust side checks that `PgWallet` has
`signTransactionMessage` (`js_sys::Reflect`). Without it, the CLI builds a
`Keypair` from `getKeypairBytes` as today. client-v2 always has the method, so
in client-v2 the key bytes are never read.

### Pre-check

`checkKeyReadable` (HOO-2680) changes its question. Under the key origin it
refuses a run whose tokens contain `--sign-only`. `solana` and `spl-token` both
accept that flag. The `anchor idl` refusal list goes away, since every `anchor
idl` subcommand now signs at send. The line keeps its wording from
`cli-line.ts`.

## Risks / Trade-offs

- **The CLI builds an unsigned-looking transaction.** Anything that verifies
  signatures locally before sending would fail. Only `--sign-only` paths do
  this (`CliSignatureVerificationStatus`), and they are refused.
- **Each send is one key-page round trip.** `solana program deploy` writes many
  buffer chunks, so it makes many requests. The key page answers in
  milliseconds, so this is acceptable. No batching is added.
- **The WASM build cannot be checked locally on stubs.** Unit tests in Rust for
  the slot filling run with `cargo test` on the host target. The JS side gets
  vitest. The end-to-end check (a devnet transfer) runs on CI's real packages or
  a preview.
- **Upstream divergence.** Until now `wasm/` held only upstream's code. The PR
  description names this as a divergence from upstream, and the feature
  detection keeps upstream's `client/` working.
