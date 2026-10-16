### How to run locally

- Install tools

Instructions on how to install [Seahorse](https://www.seahorse.dev) can be found in the [Seahorse installation guide](https://www.seahorse.dev/introduction/installation).

- Install dependencies

Extract the zip file in your project's directory and run:

```sh
yarn
```

- Build

```sh
seahorse build
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
