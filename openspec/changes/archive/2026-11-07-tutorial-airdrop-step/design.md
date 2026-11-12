# Design

## Context

The deploy runner (`features/tutorial-conversation/model/runners/deploy.ts`)
checks the balance against `rent(length) + FEE_HEADROOM`. When the balance is
short, it calls `fundForDeploy` (`runners/fund.ts`) inside a "Funding your
wallet" stage. `fundForDeploy` already handles the whole airdrop: the
shortfall, the cap, confirming, re-reading the balance, and a refusal as a
result. The engine runs an act only when it is pressed: the reducer emits a
`run` effect and the store calls `Runner.run`. No act passes on its own today.

## Goals / Non-Goals

**Goals:**

- An airdrop act whose runner reuses `fundForDeploy`, and a deploy runner that
  only checks the balance.
- A funded wallet passes the airdrop card with no press.

**Non-Goals:**

- Run and call funding (`run-call.ts`).
- The editor's deploy and airdrop.
- A new card component.

## Decisions

1. **The airdrop runner shares the deploy port.** The cost it funds for is the
   deploy's estimate, `rent(program.length ?? DEFAULT_LENGTH, onChain) +
   FEE_HEADROOM`. It is computed by one helper that both runners call, so the
   airdrop funds exactly what the deploy will check. Alternative: a fixed
   amount (the faucet cap). Rejected, because it asks the faucet for more than
   needed and gets rate-limited sooner.
2. **The funded pass is an auto-press, not a new reducer path.** When the
   cursor reaches a live airdrop card, the store reads the balance through the
   runner's funding port. If the balance covers the cost, it dispatches the
   same press action the button does. The runner then finds the wallet funded
   and lands with `airdropped: 0`, with no faucet call. The reducer, the
   record and the telemetry stay one path. Alternative: a "skipped" beat
   state. Rejected, because it touches the reducer's cursor and progress
   model for one card.
3. **The record depends on the result.** An airdrop result carries `balance`
   and `airdropped`. The card's record reads "Added {airdropped} SOL", or
   "Your wallet has {balance} SOL" when nothing was airdropped. An airdrop
   that landed posts no result card: the record is the result.
4. **Refusals reuse `no_funds`.** The airdrop's refusal and the deploy's short
   wallet both return the existing `no_funds` result. The card is the same.
   The retry line depends on the act: "Asks the faucet again" for airdrop, and
   "Checks your balance again, then deploys" for deploy.
5. **The check enforces the order.** `check.ts` refuses a deploy or
   buildDeploy act with no airdrop act since the previous deploy act, so a
   later upgrade gets its own card, which passes by itself on a funded
   wallet. That keeps Lumberjack and future
   lessons in line without a reviewer having to catch it.

## Risks / Trade-offs

- **The estimate is only a gate when it is real.** `program.length` is null
  with the real port, so the 400 KB default would stop an upgrade the wallet
  can pay for. The deploy checks the estimate before the build only on a
  known length and a build that stands; otherwise it checks after the build,
  on the real binary. The airdrop card still funds for the estimate.
- **Higher deploy cost after the airdrop.** If the binary outgrows the
  estimate, the deploy can still stop on "Not enough devnet SOL" right after
  a successful airdrop. Mitigation: `FEE_HEADROOM` and the airdrop's
  rounding up (`airdropTopUp`) leave margin. The retry card explains the next
  move.
- **A reload races the auto-press.** A reload while the balance read is in
  flight must not press twice. The auto-press goes through the same
  in-flight guard as a button press.
