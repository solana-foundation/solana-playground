# Proposal

## Why

`wallet-key-origin` (HOO-2680) keeps the built-in wallet's keys on a key page of
their own origin. Since then the terminal's `solana`, `spl-token` and the
signing `anchor idl` subcommands refuse before they start, because they read
the secret key through `PgWallet.getKeypairBytes`. HOO-2723 brings them back
without the key ever reaching the app page.

## What Changes

- The Rust CLIs stop building a `Keypair` from key bytes in client-v2. The
  wallet's signer knows only the public key and leaves a marker in its
  signature slot.
- The WASM RPC client (`wasm/solana-client`) fills that slot at the send step:
  it awaits a signature over the transaction message from the page's
  `PgWallet`, which signs through the current signer provider (the key page
  under the key origin, the in-page key under the local provider).
- `PgWallet` gains two methods for the CLIs: the current wallet's public key
  bytes, and a signature over a transaction message.
- The pre-check from HOO-2680 refuses only offline signing (`--sign-only`),
  where a CLI prints signatures without sending them. Every other run signs.
- Upstream's `client/` keeps working: when `PgWallet` lacks the new methods,
  the CLIs read the key bytes as before.
- Telemetry: none added, renamed or removed. No funnel step is touched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wallet-signing`: the WASM CLIs sign through the signer provider instead of
  refusing under the key origin.

## Impact

- Code: `wasm/utils/solana-playground-utils` (bindings, wallet signer),
  `wasm/solana-client` (deferred signing at send), `wasm/solana-cli`,
  `wasm/spl-token-cli`, `wasm/anchor-cli` (use the wallet signer);
  `client-v2/src/utils/wallet/wallet.ts`, `client-v2/src/commands/checks.ts`
  and the `solana`, `spl-token`, `anchor` commands.
- User-visible: terminal commands that sign with the built-in wallet work with
  the key origin on, and print the signature the cluster holds.
- Build: `wasm/` changes, so CI's `wasm` job rebuilds the packages once (about
  an hour cold). Local runs on the stubs cannot exercise the CLIs.
- Out of scope: `sugar` (it already signs through the wallet adapter),
  `solana sign-offchain-message`-like commands (none in the WASM port),
  versioned transactions (the CLIs build legacy ones), a confirmation prompt
  per signature, and any change to the key page's protocol.
