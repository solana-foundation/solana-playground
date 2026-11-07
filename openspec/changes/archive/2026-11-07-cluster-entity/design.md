# Design

## Context

See proposal.md, "Why". The five modules and the copy each keeps are listed in
[plans/2.1-cluster-entity.md](plans/2.1-cluster-entity.md), "Why". Two constraints shape the approach: entities do
not import each other (`client-v2/CLAUDE.md`, "Layers"), and `shared/config/client-env.ts` is the only module that
reads `process.env`.

## Goals / Non-Goals

**Goals:**

- One record per endpoint of ours (the five chips and Playnet), from which every key-to-URL question is answered.
- A type in which only a custom selection carries a URL, and a chip is named by its key.

**Non-Goals:**

- A new stored format, or a migration of stored values.
- `@solana/kit`: callers keep receiving a web3.js `Connection`.

## Decisions

- **The table lives in an entity, `entities/cluster`.** A cluster is a domain object, so `shared` is the wrong layer,
  and the legacy `constants/` root takes no new code. Alternative: keep growing `constants/connection.ts`; rejected,
  because the three copies exist precisely because nothing owned the mapping.
- **The table is keyed by chip, not by cluster.** Surfpool is a chip of its own on Localnet's cluster, so a record
  carries both its key (`surfpool`) and its cluster (`localnet`); a cluster moniker alone could not store Surfpool.
  The chips Settings offers, their order, and which of them a platform RPC can take all derive from the table.
- **`PgCustomRpcs` and the URL health check move into the same slice.** `PgCustomRpcs` needs the table to tell a
  custom URL from a chip's, and one entity may not import another. The saved list is the custom arm of the selection,
  so the two belong together. Alternative: a cross-import through `@x`; rejected, `@x` is not enabled here.
- **A selection is `{ key: <chip key> }` or `{ cluster: "custom"; url }`**, after Explorer's `ClusterSelection`.
  The stored value is derived from it, so a chip cannot be stored with a URL. Alternative: keep passing URL strings
  and guard at each writer; rejected, that was the design whose guard was missing in one writer.
- **The env's `mainnet` key becomes `mainnet-beta` once, in the table.** Callers stop re-keying by hand.
- **The slice is the only builder of a `Connection`, cached per endpoint and commitment**, as Explorer's `getRpc`
  caches one client per URL ([plans/2.2-connection.md](plans/2.2-connection.md)). The selected connection's
  cluster and health live in one store there. `PgConnection` stays as a facade, so its readers change in a later
  pass, not in the same PR. Alternative: move every reader at once; rejected, it turns one reviewable PR into a
  rewrite of 55 files.
- **Stored forms are read through the existing conversions, moved, not rewritten.** The in-source tests of
  `stored-endpoint.ts` and `custom-rpcs.ts` move with the code unchanged and pin every legacy form.

## Risks / Trade-offs

- [A legacy stored value reads back differently after the move] → the moved in-source tests cover every stored form
  (`*-platform` keys, plain strings, custom URLs), and `e2e/client-v2-custom-rpcs.e2e.spec.ts` runs on the result.
- [The move touches many importers in one PR] → importers outside the slice change only their import path; behaviour,
  ids and test ids stay.
