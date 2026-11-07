# Programs

A Solana program is code stored on chain: an account whose data is compiled
bytecode and which is marked executable. Other blockchains call these smart
contracts.

## Programs hold no state

A program keeps nothing between calls. Whatever it needs to remember lives in
separate data accounts, which a transaction passes to it with each
instruction. Hello Anchor's `hello` remembers nothing, so it takes no
accounts: it only writes a line to the transaction's log.

## Compiled to sBPF

Programs are written in Rust, most often with Anchor, and compiled to sBPF
(Solana Bytecode Format). Build in the Playground does that compiling on a
build server.

## Deploying and upgrading

Deploying writes the bytecode to an account at the program's address, its
program ID. Programs deployed with the upgradeable loader keep an upgrade
authority, the wallet that may deploy a new version to the same address.
Redeploying after a change replaces the code, and clients keep calling the
same address. Removing the authority makes the program immutable.

Until you redeploy, devnet keeps running the version you last deployed, even
if `lib.rs` has changed since.

## Read more

[Programs](https://solana.com/docs/core/programs) in Solana's docs.
