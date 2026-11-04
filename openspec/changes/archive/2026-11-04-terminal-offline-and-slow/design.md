# Design

## Context

Every terminal command, typed or started by another control, goes through
`PgCommandManager.execute` (`client-v2/src/utils/command.ts`), inside
`PgTerminal.process`, which prints what a failed command threw. A
`TerminalLineError` prints as its own line, with no "Process error:" prefix.
All output reaches the screen through `PgTerm.print`; a yes or no question
waits in `PgTerm.waitForInput`. One command can run another (deploy runs
`build` when the program is not built); the runner keeps the runs in flight
in `_runs`.

## Goals / Non-Goals

**Goals:** both lines for every command, however it was started, with one
place that decides each.

**Non-Goals:** recolouring the other Spec 13 lines (unknown command, wallet
declined), which print plain today; that is its own ticket.

## Decisions

1. **A command declares that it needs a connection.** `CommandParam` gets
   `needsConnection?: true`, set on `build`, `deploy`, `airdrop`, `run`,
   `test`, `anchor`, `solana`, `spl-token` and `sugar`. The runner checks
   `navigator.onLine` for the top-level command before its pre-checks, so no
   wallet question comes first. Alternative: a list of local commands in the
   runner. Rejected: a new command would need the network by default and
   nobody would remember the list; the flag sits where the command is read.
2. **The offline line is a `TonedLineError`,** a `TerminalLineError` that
   carries a `tone` (`"error" | "info"`). `PgTerm.process` colours the printed
   line with it (`lineTone`, `toneWith`). The error's `message` stays plain
   text, because the assistant's model and button toasts read it. Its
   repeated-line check compares xterm's text, which carries no colour codes.
3. **The slow-run clock is its own module, fed by the terminal.**
   `utils/terminal/slow-run.ts` holds one clock: `watchSlowRun(print)` starts
   it and returns a stop function; `noteOutput()` restarts it;
   `noteQuestion()` and `noteAnswer()` pause it and start it again.
   `PgTerm.print` calls `noteOutput`; `PgShell.waitForInput` calls the other
   two. The runner starts
   the clock only when no other run is in flight, so a nested run reuses the
   outer one's clock. The line goes out through `PgTerminal.println`, after
   the clock is marked fired, so its own output cannot restart it.
   Alternative: a timer inside each slow command (`build`, `deploy`).
   Rejected: Spec 13 names every command, and a button-run command must
   behave the same.

## Risks / Trade-offs

- [A local cluster is unreachable for the offline check] → `navigator.onLine`
  false means offline even for `localhost`; a person with a local validator
  and no network is rare, and Spec 13 names the cluster commands.
- [`navigator.onLine` true on a dead network] → the command fails as today,
  with the stages' network lines (HOO-2523); the slow line still appears.
