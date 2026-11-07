# Wallet CLI signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `solana`, `spl-token` and `anchor` in the terminal sign the built-in wallet's slot through the signer provider at the send step, and never read its secret key bytes in client-v2.

**Architecture:** The CLIs sign with `PgWalletSigner`, which writes a marker signature. `WasmClient::send_transaction_with_config` replaces the registered key's marker with an awaited signature from a deferred-signer registry. client-v2 answers through `PgWallet.signTransactionMessage`; upstream `client/` lacks it and keeps the key-bytes path.

**Tech Stack:** Rust 1.75 (wasm32 and host), wasm-bindgen 0.2.92, js-sys, wasm-bindgen-futures, solana-sdk 1.18; TypeScript, vitest.

**Spec:** `openspec/changes/wallet-cli-signing/` (proposal, design, `specs/wallet-signing/spec.md`).

## Global Constraints

- The marker is 64 bytes of `0xff`, never `Signature::default()`.
- `solana-client` stays generic: it takes a function, it does not import the Playground.
- Slots of signers other than the registered key are never touched.
- client-v2 never calls `PgWallet.getKeypairBytes` from these CLIs.
- `--sign-only` under the key origin ends with `keyCommandLine` from `cli-line.ts`.
- Upstream `client/` keeps working: feature detection on `PgWallet.signTransactionMessage`.

## Review Focus

- A transaction whose fee payer is a CLI-made keypair and the wallet signs second: the filled slot is the wallet's, not index 0.
- A transaction sent twice (retry after blockhash refresh, re-signed): each send asks for a fresh signature over the new message.
- The signer provider rejects (key page closed, person refuses): the CLI prints an error, nothing is sent.
- Overlapping runs of one CLI (`run-call.ts` starts `solana confirm` unawaited): no run clears the registry, and a marker whose key has no signer is a named error, never sent.
- The returned signature is the filled one, so `confirm_transaction` waits on what the cluster holds.

---

### Task 1: Deferred-signer registry in `solana-client`

**Files:**
- Create: `wasm/solana-client/src/deferred_signer.rs` (with `#[cfg(test)] mod tests`)
- Modify: `wasm/solana-client/src/lib.rs`, `wasm/solana-client/src/client.rs` (`send_transaction_with_config`)

**Interfaces:**
- Produces: `pub const DEFERRED_SIGNATURE: [u8; 64]` (all `0xff`); `pub fn deferred_signature() -> Signature`; `pub type DeferredSign = Rc<dyn Fn(Vec<u8>) -> Pin<Box<dyn Future<Output = Result<Signature, String>>>>>`; `pub fn set_deferred_signer(pubkey: Pubkey, sign: DeferredSign)`; `pub fn clear_deferred_signers()` (tests only); `pub async fn fill_deferred_signatures(tx: &Transaction) -> ClientResult<Transaction>`.

- [x] Tests (host, `futures::executor::block_on`): `fills_only_the_registered_keys_marker_slot`, `fills_the_fee_payers_slot_the_send_returns`, `leaves_a_slot_the_key_already_signed`, `a_transaction_without_markers_is_sent_unchanged`, `a_marker_with_no_signer_for_its_key_is_an_error`, `a_refused_signature_is_a_client_error`.
- [x] Run `cargo test -p solana-client-wasm --lib deferred` — FAIL.
- [x] Implement; `send_transaction_with_config` sends and returns the filled copy's `signatures[0]`.
- [x] Run tests — PASS. Commit.

### Task 2: `PgWalletSigner` and `wallet_signer()` in `solana-playground-utils`

**Files:**
- Create: `wasm/utils/solana-playground-utils/src/wallet.rs`
- Modify: `js.rs` (bindings), `lib.rs`, `Cargo.toml` (solana-sdk, solana-client-wasm, js-sys, wasm-bindgen-futures)

**Interfaces:**
- Consumes: Task 1.
- Produces: `pub struct PgWalletSigner { pubkey: Pubkey }` implementing `Signer` (marker signature, `is_interactive() == false`); `pub enum WalletSigner { Key(Keypair), Deferred(PgWalletSigner) }` implementing `Signer`; `pub fn wallet_signer() -> WalletSigner` (registers the deferred signer when `PgWallet.signTransactionMessage` exists and `PgWallet.holdsKeysInPage()` is false, else `Key` from `getKeypairBytes`).
- JS bindings: `PgWallet.getPublicKeyBytes(): number[]`, `PgWallet.holdsKeysInPage(): boolean`, `PgWallet.signTransactionMessage(message: Uint8Array, publicKey: string): Promise<Uint8Array>` (`catch`).

- [x] Tests (host): `the_marker_passes_try_sign` (`Transaction::try_sign` with it succeeds and the slot is the marker).
- [x] Implement behind the `wallet` feature; wasm-bindgen imports compile on the host, so host tests build.
- [x] `cargo test -p solana-playground-utils-wasm` PASS; commit.

### Task 3: CLIs use `wallet_signer()`

**Files:** `wasm/solana-cli/src/wasm.rs`, `wasm/spl-token-cli/src/{wasm.rs,config.rs}`, `wasm/anchor-cli/src/{utils.rs,commands/idl.rs}`.

- [x] Replace `Keypair::from_bytes(&PgWallet::keypair_bytes())` with `wallet_signer()`; no run clears the registry.
- [x] Confirm no `simulate_transaction` caller sets `sig_verify: true` (none found at plan time).
- [x] `cargo check --target wasm32-unknown-unknown -p solana-cli-wasm -p spl-token-cli-wasm -p anchor-cli-wasm` PASS; commit.

### Task 4: client-v2 `PgWallet` methods

**Files:** `client-v2/src/utils/wallet/wallet.ts`, test in `client-v2/src/utils/wallet/wallet.test.ts` (or a new `cli-signing.test.ts`).

- [x] Tests (`cli-signing.test.ts`, node environment): the methods exist under the names the WASM side looks up; the signature verifies over the exact bytes of a message compiled in Rust's key order (local provider, `secretKeyFor` never called); one `signTransaction` call; refusals for no wallet, another wallet, an unsigned transaction and a signature over other bytes. `getPublicKeyBytes` in `wallet.test.ts`.
- [x] Implement with `Transaction.populate(Message.from(bytes))` + `PgWallet.current.signTransaction`, signature read from the wallet's slot.
- [x] `yarn vitest run` on the file PASS; commit.

### Task 5: Pre-check refuses only `--sign-only`

**Files:** `client-v2/src/commands/checks.ts`, `client-v2/src/commands/anchor/anchor.ts`, `solana/solana.ts`, `spl-token/spl-token.ts`, `client-v2/src/commands/key-read.test.ts`.

- [x] Tests: `solana transfer X 0.01 --sign-only` and `spl-token transfer ... --sign-only` end with `keyCommandLine("`solana --sign-only`")` / spl-token likewise; `solana balance`, `spl-token accounts`, `anchor idl init` go on under the key origin; local provider runs everything.
- [x] Implement `signsOffline: KeyRead`; drop `everyRunReadsKey`, `anchorReadsKey` and `IDL_SIGNS`; anchor keeps only `checkPgWallet`.
- [x] Tests PASS; `yarn run check` in client-v2; commit.

### Task 6: Verify (tasks.md 3.1)

- [ ] CI `wasm` job builds the real packages; devnet `solana transfer` and `spl-token transfer` with the key origin on, on the preview.
