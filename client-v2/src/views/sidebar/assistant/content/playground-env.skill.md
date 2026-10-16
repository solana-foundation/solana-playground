# Solana Playground build environment

What this environment can and cannot compile. When another source — the
official Solana skill, the Solana docs MCP, your own training — disagrees with
this file about versions or available crates, **this file is right**, because
it describes the build server that will actually compile the user's code.

## Versions

Programs are Rust, compiled server-side by the Playground build service. Two
pins matter:

- `anchor-lang` and `anchor-spl` are **0.29.0**
- `solana-program` is **1.16.24**

## The Anchor pin applies to Anchor programs only

- **Anchor programs** compile against `anchor-lang 0.29`. APIs added in Anchor
  0.30, 0.31 or 1.x are not available. If a fix needs one, say so plainly
  instead of proposing code the server cannot compile.
- **Native programs** — anything built directly on `solana-program` without
  Anchor — are **not affected by the Anchor pin**. Modern native patterns are
  fine, as long as every crate is on the whitelist below. Do not tell a user
  writing a native program that they are limited by Anchor 0.29; they are not.
- There is no Pinocchio in the whitelist, so Pinocchio programs cannot be
  built here.

When you show a modern API for reference or learning rather than for building
in this environment, label it as such so the user does not paste it into a
file and hit a build failure.

## Crate whitelist

The build service resolves only these crates. Anything else fails at build
time, so do not add it to `Cargo.toml`.

```text
anchor-lang 0.29.0            anchor-spl 0.29.0
arrayref 0.3.7                borsh 0.10.3
borsh-derive 0.10.3           bytemuck 1.14.0
bytemuck_derive 1.5.0         mpl-bubblegum 1.0.0
mpl-token-auth-rules 1.4.3    mpl-token-metadata 3.2.3
num-derive 0.4.0              num-traits 0.2.16
pyth-sdk 0.8.0                pyth-sdk-solana 0.8.0
serde 1.0.193                 solana-program 1.16.24
spl-account-compression 0.2.0 spl-associated-token-account 2.2.0
spl-pod 0.1.0                 spl-tlv-account-resolution 0.4.0
spl-token 4.0.0               spl-token-2022 0.9.0
spl-token-metadata-interface 0.2.0
spl-transfer-hook-interface 0.3.0
spl-type-length-value 0.3.0   switchboard-solana 0.29.79
switchboard-v2 0.4.0          thiserror 1.0.48
```

Note `borsh` is **0.10**, not 1.x — the derive syntax and the
`BorshSerialize`/`BorshDeserialize` paths differ from current borsh docs.

## Tests

Tests are **TypeScript, run from the browser** against the cluster set in
Settings → Connection. There is no
Rust-side test workflow here: no `cargo test`, no `solana-program-test`, no
LiteSVM, no Mollusk, no Surfpool. If the right answer to a problem is a Rust
unit test, say that the environment cannot run one and offer the TypeScript
equivalent instead.

A built program's IDL drives a generated test panel, so the IDL is worth
keeping accurate.

## Deploy and wallet

- Deploy goes to the cluster set in Settings → Connection: devnet by default,
  and the project snapshot names the current one. It costs SOL and needs a
  wallet funded on that cluster.
- The default wallet is an in-browser keypair in local storage. Clearing
  browser data destroys it along with the projects.

## Environment limits worth naming out loud

If a fix needs any of these, tell the user rather than working around it:

- a crate outside the whitelist
- an Anchor API newer than 0.29 (for Anchor programs)
- a Rust-side test
- Pinocchio
- starting a local validator: Playground can connect to one, not run one

Naming the limit is more useful than a workaround that will not build.
