# Proposal

## Why

Spec 13 gives the terminal two lines it does not print yet
([HOO-2581](https://linear.app/solana-fndn/issue/HOO-2581)). Offline, a
command that needs the server or a cluster runs into a network error several
seconds later, worded by whatever failed ("Process error: Failed to fetch").
A command that waits on a slow server prints nothing at all until it ends, so
the person cannot tell a slow run from a stuck one.

## What Changes

- Offline, a command that needs the server or a cluster (`build`, `deploy`,
  `airdrop`, `run`, `test`, `anchor`, `solana`, `spl-token`, `sugar`) ends at
  once with "You're offline. This command needs a connection." in red (the
  design system's `error` terminal line), before any
  question it would ask. Anything else that starts one of them (the
  assistant, the wallet's airdrop) gets the same line, because all of them go
  through the command runner. The Build stage's button is already disabled
  offline (HOO-2523), so it never reaches this line.
- `help`, `clear`, `setting`, `connect`, `prettier` and `rustfmt` keep working
  offline.
- A command that prints nothing for 10 s gets "This is taking longer than
  usual." once per run, in blue (the design system's `info` line). Output restarts the 10 s; waiting on the person's
  answer to a question does not count.
- Telemetry: none added, renamed or removed. The commands live in the legacy
  `commands/` root, which has no tracker.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-terminal`: adds the offline line and the slow-run line.

## Impact

- `client-v2/src/utils/command.ts` (the command runner), a new
  `client-v2/src/utils/terminal/slow-run.ts`, `utils/terminal/terminal.ts`
  (output and questions feed the slow-run clock), and one flag on each command
  that needs a connection under `client-v2/src/commands/`.
- Out of scope: the console strip's elapsed time (it already shows one), the
  `command_finished` event and its `error_kind` (Spec 13 analytics), the
  stages' own offline states (HOO-2523), and a local cluster reached while the
  browser reports offline (it is treated as offline).
