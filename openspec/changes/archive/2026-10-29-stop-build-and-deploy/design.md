# Design

## Context

Commands run through `PgCommandManager.execute`, inside `PgTerminal.process`,
which disables the prompt and prints any thrown error as "Process error: …".
The shell dropped Ctrl+C (`\x03`) while a command ran
(`TODO: implement stopping commands`). `PgServer.build` is a plain `fetch`.
Deploy already pauses and cancels the write step through
`PgGlobal.deployState` and an `AbortController` that
`BpfLoaderUpgradeable.loadBuffer` checks between chunks, but only behind two
terminal questions ("Continue deployment?", "close the buffer account?").
The strip's status comes from `PgFlow.state` (`views/flow/state/stage.ts`).

## Goals / Non-Goals

**Goals:** one stop path shared by Ctrl+C, ⌘. and the strip; build and
deploy honour it; a stop is never shown as a failure.

**Non-Goals:** stopping every command; Kora; telemetry.

## Decisions

- **The runner owns the signal; commands opt in.** `execute` creates an
  `AbortController` per top-level run and passes `signal` and `lockStop` in
  the handler's input; a command declares `stoppable: true`, which holds from
  the run's start, pre-checks included. A run's stoppability is
  `stoppable | step | never`: `lockStop` turns a stoppable run into `step`
  (deploy's last transactions). `PgCommandManager.stop()` aborts every
  stoppable run, says nothing for a run already stopping, and otherwise
  prints why it cannot stop. Racing every handler against the signal was
  rejected: a handler that ignores it keeps running (a deploy would keep
  sending transactions) while the prompt says it stopped.
- **A stop is an error type, declared once.** `StoppedError` and `isStopped`
  live in `utils/stopped.ts`. `PgTerm.process` prints a stopped run's message
  without the "Process error:" prefix, and `PgTerminal.process` marks it
  shown, folded console or not, so no button toasts it. `PgFlow` maps a
  stopped `build` to `build-stop` and a stopped `deploy` to `deploy-stop`,
  each acting only on a run in flight, back to the status before the run;
  `stopped: RunKind | null` gives the strip its words.
- **Build drops a late reply.** The signal goes into `fetch` (an aborted
  `fetch` fails like any other request; the handler turns that failure into a
  stop); after the request settles the handler checks `signal.aborted` once
  more before touching `PgProgramInfo` or `PgBuildOutput`.
- **Deploy stops in its fundable steps and closes its buffer.** Checkpoints
  sit after the balance reads and before the buffer is created; the run's
  signal ends a load segment after the chunks in flight, and answers an open
  pause question with no. A stop that ends the write closes the buffer
  (`closeBuffer`), and the line says whether that worked. After the write a
  last check runs, then `lockStop`: the final deploy or upgrade is not
  interruptible, and a half-sent upgrade is worse than a finished one.
- **Keys.** Ctrl+C with a selection copies (`_handleCustomEvent`); without one
  it reaches `handleTermData`, which stops the command before the prompt
  bookkeeping (read from an empty line, that bookkeeping set the prompt
  prefix to "" and no prompt came back). ⌘. stops on a Mac. At a question a
  command asks, Ctrl+C does nothing; the strip's Stop is the way out.
- **The strip.** Spec 13: Clear stays off beside Stop on a desktop (TRM-28);
  on a phone Stop takes its place, 44 px. A ghost `xs` button like Clear; the
  look is asked on the designers' sync card 4.20.

## Risks / Trade-offs

- [The buffer close is one more transaction after a stop] → it runs with the
  deploy's own retries; if it fails, the line names the buffer and the
  reclaim command.
- [`deploy.ts` also changes on `scope/users-work` (HOO-2385)] → the touch
  points are listed in the proposal; Lead is told the file names.
- [The deploy loader's stop paths have no unit test] → covered by the manual
  scenarios; extracting the loader to test it is left out while HOO-2385
  changes the same file.
