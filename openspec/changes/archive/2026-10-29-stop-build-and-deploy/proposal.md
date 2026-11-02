# Proposal

## Why

Spec 13 draws the console strip as "Building… · {elapsed} · Stop". The strip
shows the words and the seconds (HOO-2324, #200), but nothing can stop a
build or a deploy: the shell drops Ctrl+C, the build awaits the server with
no abort, and the deploy's own cancel is a pause behind two terminal
questions. A person who started the wrong build waits it out (HOO-2394).

## What Changes

- A running command can be stopped. The command runner hands every run a
  stop signal; a command says whether it honours it, and can mark a step that
  cannot stop. Ctrl+C in the terminal with nothing selected (with a selection
  it copies), ⌘. on a Mac, and the strip's Stop all stop the run in flight. A
  stop pressed again while a run is stopping says nothing.
- Build honours a stop: the request to the build server is aborted and a
  reply that still arrives is dropped. Nothing about the project changes. The
  terminal prints `^C` and "Stopped.".
- Deploy honours a stop (Spec 03's Cancel) while it funds the wallet and
  writes the buffer: at the next transaction, or between chunks, with no
  questions. A stop after the buffer exists closes it and returns its SOL.
  From the final deploy or upgrade on, a stop prints "This step can't be
  stopped. Wait for it to finish." and the deploy goes on.
- A stopped run is never reported as a failure: no "Process error", no toast,
  no failed stage; the stage goes back to what it showed before the run.
- The strip shows Stop while a build or a deploy runs, folded or open. On a
  desktop Clear stays, turned off, beside it; on a phone Stop takes Clear's
  place and is at least 44 px. After a stop the strip reads "Build stopped" or
  "Deploy stopped".
- A command that does not honour a stop answers Ctrl+C with one line saying
  so.
- Telemetry: none changed. The strip and the commands live in the legacy
  roots (`views/`, `commands/`, `utils/`), outside any telemetry slice;
  Spec 13's `command_ended` (`outcome: cancelled`, `via`, `ms_to_prompt`) is a
  follow-up (ticket to file).

## Capabilities

### New Capabilities

- `client-v2-command-stop`: stopping a running terminal command (build,
  deploy) from the terminal or the console strip, and what a stop leaves
  behind.

### Modified Capabilities

None.

## Impact

- Code: `src/utils/command.ts` (stop signal, stoppability, `stop()`),
  `src/utils/stopped.ts` (new), `src/utils/server.ts` (abortable build
  request), `src/utils/terminal/shell.ts`, `terminal.ts` and `types.ts`
  (Ctrl+C, ⌘., stopped runs are not errors), `src/commands/build/build.ts`,
  `src/commands/deploy/deploy.ts` and `stopped.ts` (new),
  `src/views/flow/state/stage.ts`, `src/views/flow/console/*`.
- `deploy.ts` is also changed by HOO-2385 on `scope/users-work`: this change
  touches `handle`, `processDeploy` (signature, two checkpoints, the
  cancelled branch, the buffer close) and `loadBufferWithControl`.
- Out of scope (scope split, follow-ups): stopping `run`, `test`, `airdrop`
  and the CLIs (`solana`, `spl-token`, `sugar`), which answer Ctrl+C with
  "can't be stopped"; Kora deploys (not on this branch); the Deploy panel's
  own Cancel (Spec 03, HOO-2385); a screen-reader announcement of a stop;
  `command_ended` telemetry. Spec 13 Open question 3 is answered as above and
  confirmed by the designers' batch (sync card 4.20).
