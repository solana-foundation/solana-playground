# Program Structure

An Anchor program is a Rust file with three macros that do the routine work:
`declare_id!`, `#[program]` and `#[derive(Accounts)]`. A fourth,
`#[account]`, describes the data a program stores in accounts of its own.

```rust
use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[program]
mod hello_anchor {
    use super::*;

    pub fn hello(_ctx: Context<Hello>, name: String) -> Result<()> {
        msg!("Hello, {}!", name);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Hello {}
```

## `declare_id!`

Sets the program's address on chain, its program ID. By default it is the
public key of the keypair in `target/deploy/<program>.json`. The Playground
writes your program's key into it when you build.

## `#[program]`

Marks the module that holds the instruction handlers. Every public function
in it becomes an instruction a client can call.

- The first parameter is always `Context<T>`, where `T` lists the accounts
  the instruction needs.
- Any further parameter, such as `name: String`, is an instruction argument
  the client sends.
- A handler returns `Result<()>`: `Ok(())` succeeds, and an error fails the
  whole transaction.

`Context` gives the handler:

- `ctx.accounts`: the accounts the instruction declared, already checked;
- `ctx.program_id`: the program's own address;
- `ctx.remaining_accounts`: accounts passed but not declared;
- `ctx.bumps`: the bump seeds of the declared PDAs.

## `#[derive(Accounts)]`

Turns a struct into the list of accounts an instruction takes. Each field is
one account, checked before the handler runs, in two ways:

- **Constraints** in `#[account(...)]` above a field, such as `mut`, `init`
  or `payer = signer`.
- **Types** such as `Account`, `Signer` and `Program`, which check that the
  account is what the program expects.

`hello` reads no account, so its struct is empty.

## `#[account]`

Marks a struct as the data stored in an account the program creates. Anchor
then sets the program as the account's owner, adds an 8-byte discriminator to
the start of its data, and reads and writes the data as that type. The space
you give such an account counts those 8 bytes: `space = 8 + 8` for one
`u64`.

## Read more

[Program Structure](https://www.anchor-lang.com/docs/basics/program-structure)
on Anchor's site.
