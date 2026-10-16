### How to run locally

- Install tools

Instructions on how to install [Solana](https://github.com/solana-labs/solana) can be found in the [Solana CLI installation guide](https://docs.solana.com/cli/install-solana-cli-tools).

- Install dependencies

Extract the zip file in your project's directory and run:

```sh
yarn
```

- Build

```sh
cd program
cargo build-sbf
```

- Start a local test validator

```sh
solana-test-validator
```

- Test

```sh
yarn test
```

- Run client

```sh
yarn client
```

> **Note**
> You might need to adjust the client and test code to fully work in local Node environment since there are playground exclusive features, e.g. if you are using `pg.wallets.myWallet`, you'll need to manually load each keypair.
