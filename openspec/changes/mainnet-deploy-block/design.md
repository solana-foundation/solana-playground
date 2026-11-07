## Context

All deploy paths (the stage's pill, the terminal, Program Pal's bridge, the
explorer's context menu) call `PgCommand.deploy.execute()`, so one guard in
the command covers them. `PgConnection.cluster` is derived asynchronously
and can be `null` or still name the previous network right after a switch.

## Goals / Non-Goals

**Goals:** no mainnet transaction can leave the command; the stage tells the
user before they press anything.

**Non-Goals:** blocking mainnet reads, Interact sends, or the CLI guide's
mainnet commands.

## Decisions

- **Guard as the command's first pre-check, reading the cluster from the
  endpoint** (`PgConnection.getCluster(current.rpcEndpoint)`), not the cached
  `PgConnection.cluster`. The cached value can lag a network switch or be
  unread, and a custom RPC's genesis hash is only known by asking. First,
  so the wallet question never asks for a wallet that would not be used.
  A genesis hash that matches no known cluster passes: that network is not
  mainnet (the deploy reads it again and fails on its own if unreachable).
- **The refusal is a `TerminalLineError`**, one plain line, no stack, the
  same as other pre-check refusals.
- **The stage reads `PgConnection.cluster`** for what it shows (it re-renders
  on cluster change); the command's guard is the hard stop.
- **The pill becomes "Deploy from your machine" on Mainnet** rather than a
  disabled "Deploy to mainnet": the stage keeps one way on (DEP-20 offers
  Change network, which the summary's Network row already carries).

## Risks / Trade-offs

- [The endpoint is unreachable, so the genesis read throws] → the guard
  lets it through; the deploy's own reads fail first, before any
  transaction.
