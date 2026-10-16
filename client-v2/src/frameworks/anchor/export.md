### How to run locally

- Install tools

Instructions on how to install [Anchor](https://github.com/coral-xyz/anchor) can be found in the [Anchor installation guide](https://www.anchor-lang.com/docs/installation).

- Install dependencies

Extract the zip file in your project's directory and run:

```sh
yarn
```

- Build

```sh
anchor build
```

- Test

```sh
anchor test
```

- Run client

```sh
anchor run client
```

> **Note**
> You might need to adjust the client and test code to fully work in local Node environment since there are playground exclusive features, e.g. if you are using `pg.wallets.myWallet`, you'll need to manually load each keypair.
