# IDL

The IDL (Interface Definition Language) is a JSON file that describes a
program's instructions and accounts. A client reads it to know what it can
call, with which accounts and arguments, and how to encode them.

## Where it comes from

`anchor build` writes it to `target/idl/<program>.json`. In the Playground,
Build makes it for you: the terminal's "IDL: 1 instruction" line is this file,
and the Call panel draws its form from it.

## Instructions

The `instructions` array has one entry per public function in `#[program]`,
with the accounts and arguments it takes. For Hello Anchor's `hello`, once it
takes a name:

```json
{
  "name": "hello",
  "discriminator": [149, 118, 59, 220, 196, 127, 161, 179],
  "accounts": [],
  "args": [{ "name": "name", "type": "string" }]
}
```

## Accounts

The `accounts` array lists the structs marked `#[account]`, the data the
program stores. Hello Anchor stores nothing, so its list is empty.

## Discriminators

Anchor gives each instruction and each account type an 8-byte discriminator
that identifies it. For an instruction it is the first 8 bytes of
`sha256("global:<name>")`; for an account, of `sha256("account:<Name>")`. The
client puts the instruction's discriminator at the start of the instruction
data for you, so you rarely touch it yourself.

## From the client

A TypeScript client built from the IDL calls an instruction by name:

```ts
const txHash = await pg.program.methods.hello("Ada").rpc();
```

Change an instruction's arguments in `lib.rs`, build again, and the client
and the Call panel follow the new IDL.

## Read more

[Program IDL File](https://www.anchor-lang.com/docs/basics/idl) on Anchor's
site.
