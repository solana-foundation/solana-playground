# Design

## Context

`PgWallet.state === "sol"` makes the extension named by `standardName` the current wallet, and
`commands/deploy/deploy.ts` already splits a deploy when the current wallet is not a Playground one:
`standardWallet` sends `required + 0.1 SOL` to the first Playground account, which creates and writes
the buffer and hands its authority to the extension; the extension signs the final deploy or upgrade.
`connect <wallet>` in `commands/connect/connect.ts` is the only way to get there.

## Decisions

**1. The chip connects through the same state change as `connect`.** `PgWallet.update({ state: "sol",
standardName })` after the wallet's own `connect()`; disconnect calls the wallet's `disconnect()` and goes
back to `state: "pg"`. One code path for the terminal and the chip (`makeStandardCurrent` /
`disconnectStandard` in `commands/connect`), so a reload reconnects the same way. A wallet already
connected as a Fund-dialog payer is made current as it is, never toggled off.

**2. The leftover is "what the Playground wallet holds over its balance before the run".** The balance is
read before the extension's transfer. Whatever the outcome, once the buffer is settled, the Playground
wallet sends `now - before - fee` to the extension when that is positive. This covers the 0.1 SOL fee
headroom, a buffer closed after a failure before its authority went to the extension (its rent lands in the
Playground wallet), and a stop before the buffer existed. A buffer closed after the hand-over is closed by
the extension, which takes its rent directly and is asked a third time for it (existing behaviour, unnamed in
the progress). The return never touches SOL the Playground wallet had before, is signed by the Playground
wallet, and names a compute unit price of 0 so `PgTx` adds no priority fee and its fee is exactly 5000
lamports.

**3. A failed return is named, never thrown.** The deploy's own result or error is what the person needs;
a failed return prints "{n} SOL stayed in your Playground wallet" and is reported to the logs.

**4. Approvals are run state.** `DeployRunState.approval: { wallet, n } | null` is set around the
extension's two signatures and read by `BaseDeployProgress`. The stage's who-pays line names the
extension (`DeployPayer.name`) and adds the two approvals before a run.

## Risks

- A deploy where the extension's transfer landed but its confirmation failed: the before-balance is read
  first, so the return still sends back what arrived.
