# Design

## Context

Networks come from three lists that drift apart: the `Endpoint` enum
(public URLs), `PLATFORM_ENDPOINTS` (env URLs, named "… (Platform)"), and the
chips in `BaseNetworkChoice`, which list both. `stored-endpoint.ts` stores a
pick as an option key (`devnet`, `mainnet-beta`, `devnet-platform`, …) so an
env rotation reaches every profile. Cluster names reach the screen raw from
`PgConnection.cluster` (`devnet`, `mainnet-beta`) or through `networkName`,
which lowercases mainnet.

## Goals / Non-Goals

**Goals:** one list of offered networks; one function that turns a cluster
moniker into its display name; old profiles land on the new chips.

**Non-Goals:** removing the `Endpoint` enum members (Playnet, Localnet and
Testnet stay reachable through code paths such as the local build server's
"use Localnet" button and keep their stored keys); custom RPC entry
(HOO-2489); renaming the `mainnet-beta` moniker.

## Decisions

- **`NETWORKS` in `constants/connection.ts`** holds `{ name, cluster, value }`
  for Devnet and Mainnet, each `value` the platform URL or the public one.
  The chips, the endpoint setting's values and `getCluster` read it. Testnet
  leaves the platform list: Slava, 2 Nov 2026, "only our platform Devnet and
  Mainnet". Alternative, keeping `PLATFORM_ENDPOINTS` and hiding public
  entries in the widget: two lists again, rejected.
- **Stored keys.** The two options are stored as `devnet` and `mainnet-beta`,
  the keys the public picks already used, so those profiles move to the
  platform URL without a migration step. The public URLs stay keyed under the
  same keys as aliases (read resolves a key to its first entry, the offered
  URL), and `devnet-platform` / `mainnet-beta-platform` are read-only aliases
  for profiles written since the platform options existed. `testnet`,
  `localnet` and `playnet` keep their keys and addresses.
- **`clusterName(cluster)`** in `constants/connection.ts` (a legacy root every
  layer may import): `mainnet-beta` → "Mainnet", others capitalised, `null`
  → `null`. `networkName` (deploy's prose helper) delegates to it, so every
  existing caller turns capitalised at once; the raw sites (Interact head and
  history, Explorer labels, fund dialog, footer status) call it directly.
- **Moniker stays `mainnet-beta`.** Probe, 2 Nov 2026: `getGenesisHash` on
  `api.mainnet-beta.solana.com` and `api.mainnet.solana.com` both return
  `5eykt4Us…N9d`; web3.js and the explorers still name the cluster
  `mainnet-beta`.

## Risks / Trade-offs

- [A deployment without platform env shows public URLs under the new names]
  → Intended fallback; production and previews set both env vars.
- [A public URL typed as a custom endpoint is stored under the offered key
  and reads back as the platform URL] → Same cluster, better RPC; accepted.
- [Terminal output still prints raw monikers] → Out of scope; terminal text
  is command output, not a screen label.
