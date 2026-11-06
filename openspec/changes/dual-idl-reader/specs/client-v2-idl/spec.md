# Spec Delta

## Purpose
Which Anchor IDL versions client-v2 reads, how an Anchor 1.x IDL maps onto the
shape the client calls a program with, and when an IDL is refused instead.

## ADDED Requirements

### Requirement: Both IDL versions are read
The client SHALL read an Anchor IDL in the 0.29 shape (top-level `name` and
`version`) and in the shape of spec 0.1.0 that Anchor writes from 0.30 on, 1.x
included (`metadata.spec`, with `address` when the program declares one). A 0.29
IDL SHALL be used exactly as given. Anything else SHALL be refused as "not an
Anchor IDL".

#### Scenario: A 0.29 IDL
- **WHEN** the IDL has a top-level `name`, `version` and `instructions`
- **THEN** Interact, the Anchor client and the JS runtime use it unchanged

#### Scenario: A 1.x IDL
- **WHEN** the IDL has `metadata.spec` and `instructions`
- **THEN** Interact lists every instruction under its camelCase name, with its accounts (writable and signer flags, optional accounts) and its arguments

### Requirement: A 1.x IDL calls with the program's own bytes
For a 1.x IDL, an instruction's data SHALL be its IDL `discriminator` followed
by the borsh encoding of its arguments, accounts and events SHALL decode by
their IDL discriminators (except an account type that another type holds and
an argument reaches, which the 0.29 coder can keep in one place only, and
which is kept as a type), and defined types (structs with named or tuple
fields, enums, aliases, generic types with their type and const arguments)
SHALL encode as the program defines them.

#### Scenario: An instruction with a struct and an enum argument (manual)
- **WHEN** a 1.x instruction takes a struct and an enum argument
- **THEN** the encoded data equals the instruction's discriminator followed by the borsh bytes of both arguments

#### Scenario: A generic type argument (manual)
- **WHEN** a 1.x instruction takes `GenericType<u32, u64, 10>`
- **THEN** the argument encodes with `u32`, `u64` and arrays of length 10 in place of `T`, `U` and `N`

### Requirement: A 1.x IDL the client cannot call faithfully is refused
A 1.x IDL with a discriminator that is not Anchor's default for its
instruction, account or event, or with a type the 0.29 coder does not know,
SHALL be refused with a reason naming it. Where the client cannot call it
from a script, the error SHALL carry that reason instead of "IDL not found". A
refused IDL SHALL never be called.

#### Scenario: A custom discriminator (manual)
- **WHEN** a 1.x instruction's discriminator differs from the first eight bytes of `sha256("global:<name>")`
- **THEN** the IDL is refused with a reason naming the instruction and "custom discriminator"

### Requirement: The IDL is kept as it arrived
The client SHALL store an IDL from a build, from Upload IDL or from the
on-chain fetch as it arrived, and Download IDL SHALL return that file. The
version mapping SHALL happen only where the IDL is read.

#### Scenario: Downloading a 1.x IDL (manual)
- **WHEN** a program built with Anchor 1.x is built and the person clicks Download IDL
- **THEN** the file is the 1.x IDL the build returned, with `address` and `metadata.spec`

### Requirement: PDA seeds derive with their own program
An account's PDA SHALL derive from its seeds with the seed program the IDL
names (`pda.program` in 1.x, `pda.programId` in 0.29) and with the current
program when it names none. A 1.x seed SHALL take its type from the
instruction argument or account its path names; a seed that reads a field of
an argument or of an account's data SHALL leave the account to the person. A
constant seed SHALL show as text when its bytes are printable UTF-8 without
quotes or edge spaces, as an address when it is 32 other bytes, and as a byte
array otherwise.

#### Scenario: An associated token account (manual)
- **WHEN** a 1.x instruction's account is an associated token account with seeds `[owner, token_program, mint]` and the associated token program as its seed program
- **THEN** Interact derives the address with the associated token program, not the current program

### Requirement: Programs of both versions call on devnet
A program built with Anchor 1.x and one built with 0.29 SHALL each show their
instructions and accounts in Interact and call successfully on devnet.

#### Scenario: One program of each version (manual)
- **WHEN** on the preview, one program built with Anchor 1.x and one built with 0.29 are deployed on devnet and opened in Interact
- **THEN** each shows its instructions and accounts, and a call to each succeeds
