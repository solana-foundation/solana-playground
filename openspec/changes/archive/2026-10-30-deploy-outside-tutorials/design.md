# Design

## Context

The deploy runs in the `deploy` command (`commands/deploy/deploy.ts`), shared
by the terminal, the Deploy stage and the assistant's bridge. Its questions
(wallet connect in `checkWallet`, airdrop, failed build) go through
`PgTerminal.waitForInput`, and its progress reaches the UI only as
`PgView.setMainSecondaryProgress`. The stage (`views/flow/stages/Deploy.tsx`,
`BaseDeploy.tsx`) sits in a legacy root. History records come from
`PgCommand.deploy.onDidFinish`, whose result is `void`, so `signature` is
always `null`. Block explorers build every link from `PgConnection.cluster`.

## Goals / Non-Goals

**Goals:** the stage reports and answers a run without the terminal; the
terminal path keeps its behaviour; history links carry their own network.

**Non-Goals:** moving `BaseDeploy` into a layer (the UI move rule's move
costs more than this ticket, so the new parts are built in a slice and the
stage composes them); Cancel and pause from the panel; Kora.

## Decisions

### D1. The command reports progress and takes answers through one run object

`commands/deploy/run.ts` exports `PgDeployRun`: the current step
(`funding | buffer | write | deploy`), the write percent, an event for
changes, and an optional `answers` object (`confirmStaleBuild(): Promise<boolean>`)
set by the caller for one execution; its presence also means the run funds
without asking. The command reads it
where it asks today: with `answers`, it skips `waitForInput` for the failed
build, funds without a question, and throws a typed `DeployFundingError`
(balance, needed, address, reason) instead of asking. Without `answers`, the
terminal path is unchanged.

Alternative: a second command for the panel. Rejected: two copies of the
deploy logic drift, and the assistant's bridge must keep calling one command.

### D2. The run returns its signature and cost

`processDeploy` already returns the final transaction's signature; `handle`
returns `{ signature, cost, upgraded }`, cost being the paying wallets'
balance before minus after. `PgDeployHistory.init` stores them. The bridge's
`deploy()` keeps linking the program address, which an upgrade keeps.

### D3. Explorer links take a cluster

`BlockExplorerParam.getClusterParam(cluster)` takes the cluster, and
`getAddressUrl(address, cluster?)` / `getTxUrl(sig, cluster?)` default to
`PgConnection.cluster`. Every existing caller keeps its behaviour; the
history and result card pass the record's cluster.

### D4. A feature slice holds the new UI and the events

`features/deploy` (prefix `deploy`) holds `model/` (the run state as a React
hook over `PgDeployRun`, the stage's run store `PgStageDeploy`, the backup
choice store, telemetry) and `ui/` Base components: `BaseDeployProgress`,
`BaseNotEnoughSol`, `BaseStaleBuildDialog`, `BaseBackupLine`. It imports no
other feature: the stage (`views/flow/stages/Deploy.tsx`) connects sign-in
(`@/features/auth`) and the wallet export. The result card stays in
`BaseDeploy`, edited in place.

### D5. Cost estimate for the approval card

`estimateDeployCost()` in `commands/deploy/estimate.ts` fetches the built binary's
length the way the deploy does, then sums the rent the run must hold (buffer,
and the program-data extension on an upgrade, as `processDeploy` computes)
and the write fees (one signature per write chunk plus the fixed
transactions). An upgrade's buffer rent returns to the wallet, so for an
upgrade the estimate is extension rent plus fees. Any failure returns `null`
and the card leaves the cost out.

### D6. "Not now" is kept per wallet address in `localStorage`

One small key (`flow.backupDismissed`, a list of addresses, capped at 20).
`localStorage` is near its origin budget (root `CLAUDE.md`), and this list
stays under a kilobyte.

## Risks / Trade-offs

- [The faucet refuses often on devnet] → the card shows the reason, "Try
  again" and the web faucet.
- [The estimate differs from the real cost] → the card says "about", and the
  result card shows the measured cost.
- [A terminal-started deploy shows progress in the stage but asks in the
  terminal] → intended: the person who typed the command answers where they
  typed.

## Migration Plan

Records already in `flow.deploys` have `signature: null` and no `cost`; the
reader accepts both, and the card omits what is missing. No rollback step.
