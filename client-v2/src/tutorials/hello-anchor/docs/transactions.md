# Transactions

A transaction includes one or more [instructions](https://solana.com/docs/core/instructions), the
signatures of accounts that authorize the changes, and a recent blockhash. The
network processes all instructions in a transaction together. If any instruction
fails, the entire transaction fails and all state changes are reverted.

- [Transaction Structure](https://solana.com/docs/core/transactions/transaction-structure): Signatures, message format (header, account addresses, blockhash, compiled instructions), binary encoding, size budget, and a SOL transfer example.
- [Versioned Transactions](https://solana.com/docs/core/transactions/versioned-transactions): Legacy vs V0 format, Address Lookup Tables, ALT resolution, and version comparison.
- [Transaction Pipeline](https://solana.com/docs/core/transactions/transaction-pipeline): Full 8-stage processing pipeline (receive through commit), reading transaction details from the network, and validation error reference.
- [Durable Nonces](https://solana.com/docs/core/transactions/durable-nonces): Offline signing with durable nonces, nonce lifecycle, detection, validation flow, and failure behavior.
- [Production Readiness](https://solana.com/docs/tools/transaction-landing#transaction-landing): Configure transaction landing, retries, priority fees, and confirmation for mainnet applications.

## Key facts

- **Atomic execution**: All instructions succeed or all revert. Fees are still
  charged on failure.
- **Size limit**: 1,232 bytes maximum, derived from the IPv6 minimum MTU (1,280
  bytes) minus 48 bytes for network headers. The
  [v1 format](https://solana.com/docs/core/transactions/versioned-transactions#v1-format) raises
  this to 4,096 bytes.
- **Signatures**: Each signer provides one 64-byte Ed25519 signature.
- **Blockhash expiry**: A transaction's recent blockhash is valid for 150 slots.

## Limits

| Limit | Value | Source |
| --- | --- | --- |
| Max transaction size | 1,232 bytes | [`PACKET_DATA_SIZE`](https://github.com/anza-xyz/solana-sdk/blob/clock%40v2.2.3/packet/src/lib.rs#L32) |
| Max accounts per transaction | 64 (96 for v1 with [SIMD-0596](https://solana.com/upgrades/v1-account-limit)) | [Enforced limit](https://github.com/anza-xyz/agave/blob/v3.1.8/runtime/src/bank.rs#L2942) |
| Blockhash expiry | 150 slots | [`MAX_PROCESSING_AGE`](https://github.com/anza-xyz/solana-sdk/blob/clock%40v2.2.3/clock/src/lib.rs#L133) |
| Signature size | 64 bytes (Ed25519) | -- |
| Base fee per signature | 5,000 lamports | [Fees](https://solana.com/docs/core/fees/fee-structure#base-fee) |
| Max executed instructions | 64 (top-level + CPIs) | [`MAX_INSTRUCTION_TRACE_LENGTH`](https://github.com/anza-xyz/agave/blob/v3.1.8/transaction-context/src/lib.rs#L41) |
| Max signatures per packet | 12 | [`MAX_SIGNATURES_PER_PACKET`](https://github.com/anza-xyz/agave/blob/v3.1.8/transaction-view/src/signature_frame.rs#L18) |
