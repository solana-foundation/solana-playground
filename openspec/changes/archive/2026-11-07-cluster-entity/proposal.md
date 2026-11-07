# Proposal

## Why

What an endpoint of ours is (its key, the cluster it talks to, its name, public URL, the platform RPC the env sets,
the read-buffer RPC and the send cap) is spread across five client-v2 modules, three of which rebuild the
key-to-URL mapping on their own. Adding the Testnet env touched all five, and missing one saved the platform Testnet
URL, its API key included, into `localStorage` (HOO-2362). The rule that `localStorage` holds a chip's key, and a URL
only for a custom RPC, is a convention no type enforces, so the next chip or env variable can break it again.

## What Changes

- Settings keeps offering the five network chips of `client-v2-custom-rpcs` (Mainnet, Devnet, Testnet, Localnet,
  Surfpool, then the saved custom RPCs). Each chip comes from one table that names its key (`mainnet-beta`, `devnet`,
  `testnet`, `localnet`, `surfpool`) and the cluster it talks to; Surfpool's key is its own, and its cluster is
  `localnet`.
- `localStorage` holds a chip's key, and a URL only for a custom RPC the user chose. A platform RPC URL is never
  stored, so a rotated API key reaches every profile on its next load. A public URL picked as a custom RPC while its
  chip is on a platform RPC stays that custom RPC after a reload.
- `REACT_APP_TESTNET_RPC_URL` names the RPC the Testnet chip opens, as `REACT_APP_DEVNET_RPC_URL` and
  `REACT_APP_MAINNET_RPC_URL` do for theirs.
- One table in a new `entities/cluster` slice, which also holds the saved custom RPCs and the health check of a typed
  RPC URL; the settings storage, the connection, the constants and the Settings widget read it instead of keeping
  their own copies. The stored formats do not change.
- Connections in one place: the same slice is the only module that builds a web3.js `Connection` (one cached per
  endpoint and commitment, the read-buffer connection included) and the one store of the selected connection's
  cluster and health; `PgConnection` becomes a facade over it, and the status widgets read it instead of polling on
  their own. The user sees no change; the next RPC setting, or a move to `@solana/kit`, touches one slice.
- Telemetry: no event is added, renamed or removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-custom-rpcs`: the connection endpoint is stored as its chip's key, a URL only for a custom RPC, and each
  remote chip opens the platform RPC its env variable names.

## Impact

- Code: a new `client-v2/src/entities/cluster/` replacing `client-v2/src/entities/custom-rpc/`, and its callers
  `client-v2/src/settings/stored-endpoint.ts`, `client-v2/src/utils/connection.ts`,
  `client-v2/src/constants/connection.ts` and `client-v2/src/widgets/settings-page/`; for connections, the builders in
  `client-v2/src/commands/deploy/`, `client-v2/src/commands/sugar/`, `client-v2/src/utils/js-runtime/` and
  `client-v2/src/utils/playnet/`, and the status readers in `client-v2/src/hooks/useConnection.tsx`,
  `client-v2/src/widgets/session-footer/` and `client-v2/src/widgets/status/`.
- Configuration: none new; `REACT_APP_TESTNET_RPC_URL` is listed in `client-v2/.env.example`.
- Stored data: none migrated; every value stored before reads back as it does now.
- Out of scope: the deploy path (send pacing, the read-buffer RPC), which `deploy-rpc-pacing` owns and which reads
  the table's values unchanged; moving to `@solana/kit`; the connection code generated into exported projects, which
  is the user's code.
