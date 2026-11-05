# Programs

A Solana program is an
[account](https://solana.com/docs/core/accounts/account-types#program-accounts) that contains
executable sBPF bytecode and has its `executable` flag set to `true`. Programs
are stateless. All mutable state lives in separate data accounts passed via
[instructions](https://solana.com/docs/core/instructions).

- [Program Execution](https://solana.com/docs/core/programs/program-execution): Compilation, writing programs (Anchor, Pinocchio, or Native Rust), sBPF VM, compute unit model, syscalls, program cache.
- [Program Deployment](https://solana.com/docs/core/programs/program-deployment): Deploying, upgrading, and verifying programs. Loader-v3 instruction reference and loader programs.
- [Core Programs](https://solana.com/docs/core/programs/builtin-programs): System Program (with instruction reference), Vote, Stake, Config, Compute Budget, Address Lookup Table, and ZK ElGamal Proof.
- [Precompiles](https://solana.com/docs/core/programs/precompiles): Ed25519, Secp256k1, Secp256r1 signature verification programs. Offset structs and validation rules.
- [Syscall Reference](https://solana.com/docs/core/programs/syscall-reference): Complete reference for all ~30 sBPF syscalls with compute unit costs.

## Key facts

- **Compiled to sBPF**: Programs are compiled to Solana Bytecode Format (sBPF)
  via LLVM and stored in executable accounts.
- **Stateless**: All mutable state lives in separate data accounts, not in the
  program account.
- **Upgradeable**: Programs deployed with loader-v3 (BPF Loader Upgradeable) can
  be upgraded when an upgrade authority is set; revoking that authority makes
  the program immutable.

## Limits

| Limit | Value | Source |
| --- | --- | --- |
| Default heap size | 32 KiB | [`HEAP_LENGTH`](https://github.com/anza-xyz/solana-sdk/blob/clock%40v2.2.3/program-entrypoint/src/lib.rs#L42) |
| Max heap size (adjustable) | 256 KiB | [`MAX_HEAP_FRAME_BYTES`](https://github.com/anza-xyz/agave/blob/v3.1.8/program-runtime/src/execution_budget.rs#L48) |
| Stack frame size | 4,096 bytes | [`STACK_FRAME_SIZE`](https://github.com/anza-xyz/agave/blob/v3.1.8/program-runtime/src/execution_budget.rs#L37) |
| Max sBPF call depth | 64 | [`MAX_CALL_DEPTH`](https://github.com/anza-xyz/agave/blob/v3.1.8/program-runtime/src/execution_budget.rs#L34) |
| Max instruction stack depth (top-level + CPIs) | 5 (9 with [SIMD-0268](https://solana.com/upgrades/cpi-nesting-depth)) | [`MAX_INSTRUCTION_STACK_DEPTH`](https://github.com/anza-xyz/agave/blob/v3.1.8/program-runtime/src/execution_budget.rs#L8), [`MAX_INSTRUCTION_STACK_DEPTH_SIMD_0268`](https://github.com/anza-xyz/agave/blob/v3.1.8/program-runtime/src/execution_budget.rs#L10) |
| Heap cost | 8 CUs per 32 KiB page | [`DEFAULT_HEAP_COST`](https://github.com/anza-xyz/agave/blob/v3.1.8/program-runtime/src/execution_budget.rs#L43) |
| Max cached programs | 512 | [`MAX_LOADED_ENTRY_COUNT`](https://github.com/anza-xyz/agave/blob/v3.1.8/program-runtime/src/loaded_programs.rs#L31) |
| Deployment visibility delay | 1 slot | [`DELAY_VISIBILITY_SLOT_OFFSET`](https://github.com/anza-xyz/agave/blob/v3.1.8/program-runtime/src/loaded_programs.rs#L32) |
