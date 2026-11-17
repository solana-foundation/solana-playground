### How to run locally

- Install tools

Instructions on how to install [Solana](https://github.com/anza-xyz/agave) can be found in the [Solana installation guide](https://solana.com/docs/intro/installation).

- Install dependencies

Extract the zip file in your project's directory and run:

```sh
yarn
```

- Build

```sh
cargo build-sbf --manifest-path program/Cargo.toml
```

- Create a wallet, if the Solana CLI has none

```sh
solana-keygen new
```

- Start a local test validator

In a second terminal, from the same directory:

```sh
solana-test-validator
```

- Deploy

```sh
solana program deploy --url localhost program/target/deploy/*.so
```

- Test

```sh
yarn test
```

- Run client

```sh
yarn client
```

The test and the client send their transactions to the local validator, from the Solana CLI's default wallet (`~/.config/solana/id.json`), to the program deployed from `program/target/deploy`.

> **Note**
> You might need to adjust the client and test code to fully work in local Node environment since there are playground exclusive features, e.g. if you are using `pg.wallets.myWallet`, you'll need to manually load each keypair.
