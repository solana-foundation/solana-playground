### How to run locally

- Install tools

Instructions on how to install [Anchor](https://github.com/solana-foundation/anchor) can be found in the [Anchor installation guide](https://www.anchor-lang.com/docs/installation).

- Install dependencies

Extract the zip file in your project's directory and run:

```sh
yarn
```

- Build

```sh
anchor keys sync
anchor build
```

`anchor keys sync` writes the program's id, the key in `target/deploy/<name>-keypair.json`, into `declare_id!`; without it a call to the program fails with `DeclaredProgramIdMismatch`.

- Test

```sh
anchor test
```

A project with no tests gets `tests/<name>.ts`, which only checks that the program is deployed and is meant to be replaced.

- Run client

```sh
anchor run client
```

`anchor test` tears its validator down when it finishes, so start `solana-test-validator` and run `anchor deploy` first (or point `[provider] cluster` in `Anchor.toml` at devnet).

> **Note**
> You might need to adjust the client and test code to fully work in local Node environment since there are playground exclusive features, e.g. if you are using `pg.wallets.myWallet`, you'll need to manually load each keypair.
