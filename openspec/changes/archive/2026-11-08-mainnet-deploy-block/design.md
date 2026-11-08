## Context

All deploy paths but the tutorial runner (the stage's pill, the terminal, Program Pal's bridge, the
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
- **Checked again in `processDeploy`, on the connection it sends on**, before
  the first send: the network can change while the wallet question waits.
  That read also gives the deploy record its cluster, replacing a separate
  read.
- **An unknown genesis passes, an unread one is refused.** A genesis hash no
  known cluster names (`UnknownClusterError`) is a network of its own, not
  mainnet. An endpoint that does not answer (down, rate-limited, refusing the
  method) could be mainnet, so the deploy is refused rather than sent on a
  guess.
- **The tutorial runner is the one path outside the command.** It was already
  devnet-only by the cached name; it now also refuses while that name is
  still the previous endpoint's (`clusterIsStale`).
- **The refusal is a `TerminalLineError`**, one plain line, no stack, the
  same as other pre-check refusals.
- **The Deploy stage runs the same check before it connects a wallet.**
  A press that reaches the stage while the network moves to Mainnet is
  refused before `deploy_started` and before a Playground wallet is created.
  Only the mainnet refusal stops there; an endpoint that does not answer is
  left to the command, which refuses it in the terminal with its own line.
- **A mainnet refusal is not a failed deploy.** It is a
  `MainnetDeployRefusedError`, which the stage does not track as
  `deploy_failed`; its toast reads "Can't deploy here: on mainnet, deploy
  from your machine…" instead of "Could not deploy."
- **The stage reads `PgConnection.cluster`** for what it shows (it re-renders
  on cluster change); the command's guard is the hard stop.
- **The pill becomes "Deploy from your machine" on Mainnet** rather than a
  disabled "Deploy to mainnet": the stage keeps one way on (DEP-20 offers
  Change network, which the summary's Network row already carries).

## Risks / Trade-offs

- [A custom RPC that blocks `getGenesisHash` but serves everything else
  can no longer deploy] → it says the network could not be read; the CLI
  guide stays open to it.
