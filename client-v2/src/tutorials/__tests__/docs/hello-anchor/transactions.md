# Transactions

A transaction is how anything happens on Solana. It carries one or more
instructions, the signatures of the accounts that authorize them, and a recent
blockhash.

## Instructions

Each instruction names:

- the program to call, by its program ID;
- the accounts it reads or writes, each marked as signer, writable or both;
- its data: which instruction, and its arguments. With Anchor, that is the
  instruction's discriminator followed by the encoded arguments.

Calling `hello` sends one transaction with one instruction for Hello Anchor's
program, signed by your wallet, which pays the fee.

## All or nothing

The instructions in a transaction run in order, and together: if any one
fails, the whole transaction fails and every change it made is undone. The fee
is still charged.

## Limits worth knowing

- A transaction is at most 1,232 bytes.
- Each signature is a 64-byte Ed25519 signature, and the base fee is 5,000
  lamports per signature.
- The recent blockhash expires after 150 slots, about a minute; a transaction
  sent later is refused and has to be signed again.

## Reading one

A transaction's signature is its ID. Explorer shows its instructions, its fee,
its compute units and its log, where `msg!` lines appear:
`Program log: Hello, Ada!`.

## Read more

[Transactions](https://solana.com/docs/core/transactions) in Solana's docs.
