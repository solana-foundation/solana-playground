# Tasks

Group 1 lands first; 2.1 builds on it.

## 1. Stored keys and the Testnet env (`client-v2-custom-rpcs`)

- [x] 1.1 Open the Testnet chip on `REACT_APP_TESTNET_RPC_URL`, read a stored `testnet` key back as it, and name its
  cluster without a request; verify with `yarn test-unit src/constants src/settings/stored-endpoint.ts
  src/utils/connection.read-buffer.test.ts` (HOO-2362)
- [x] 1.2 Never adopt into the saved list an address a chip opens (Testnet, Localnet and Surfpool included) in
  `PgCustomRpcs.adopt`; verify with `yarn test-unit src/entities/cluster` (HOO-2362)
- [x] 1.3 Store a public URL picked as a custom RPC beside a platform chip as that custom URL, and list it as a custom
  chip named by its host and checked (`toStoredEndpoints`, `PgCustomRpcs`); verify with
  `BaseNetworkChoice.platform.test.tsx` expecting a checked `api.devnet.solana.com` chip (HOO-2362)

## 2. One cluster table

- [x] 2.1 Resolve every chip from one table in an `entities/cluster` slice that also holds the saved custom RPCs,
  with the stored settings and `customRpcs` formats unchanged ([plan](plans/2.1-cluster-entity.md)); depends on group 1;
  verify that `yarn test-types`, `yarn lint`, the touched unit tests and `e2e/client-v2-custom-rpcs.e2e.spec.ts` pass
  (HOO-2362)
- [x] 2.2 Build every connection, and hold the selected connection's cluster and health, in `entities/cluster`, with
  `PgConnection` as a facade over it ([plan](plans/2.2-connection.md)); depends on 2.1; verify that no module outside
  the slice constructs a `Connection` (grep), and that `yarn test-types`, `yarn lint`, the touched unit tests and the
  `client-v2-status` and `client-v2-custom-rpcs` e2e specs pass (HOO-2362)
