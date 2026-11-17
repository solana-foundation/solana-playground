# HOO-2806: a failed run or call runs again

Bug ticket, inline. Ticket: https://linear.app/solana-fndn/issue/HOO-2806.
Base `scope/interface-3`.

## Goal

After a run or call fails, the learner can run it again from the feed: the
failed card has a live act card under it, as a failed deploy's Try again.
Today the act card gives way to the failed result and nothing follows.

## Shape

- `view.ts`: `retryOf` returns `fix` for a failed run or call (no reason, or
  `no_transaction`) and `again` for its `no_funds`; null for `no_wallet` and
  `unconfirmed` (that card has Check again). `tryAgain` gives a run or call
  the button "<first word of its button> again" and, for `fix`, the line
  `FIX_AND_RUN` / `FIX_AND_CALL`. The card is the existing
  `<beat>:retry` act turn, so it carries a call's fields, waits while an act
  runs and gives way once the new run starts.
- A button on the result card was the first idea; a call act with fields
  (Hello Anchor's `name`) would send no arguments from there, since a failed
  result does not keep them, so the act card it is.
- Engine: unchanged. `act` already runs a beat whose last run failed while
  the step has not passed; a landed run is judged on the goal.
- Spec: a sentence and a scenario under "Client runs and calls send real
  transactions".

## Terminal

`run` and `test` complete their paths from the scripts under `client/` and
`tests/`, but no longer have `PgCommandManager` refuse a path the list does
not hold (`Arg.suggestOnly`): `runFiles` refuses it inside `processCommon`,
so `run_errored {reason: "other"}` is sent (funnel-events, "A file that does
not exist"). A relative path is looked for in the command's own folder, as
the completion list offers it, so `run tests/x.test.ts` is still refused. Its line names the scripts there are, or, with none, where to
add one. A refused value of any other command with nothing to choose from
says so instead of "(possible values: )". The shell's Enter reports a
failed command through `reportUnhandled` rather than leaving an unhandled
rejection, so the console shows no "Uncaught (in promise)".

## A client run outside the card

Only the Call panel called `PgConversation.passed`, so a `run` typed in the
terminal on step 3 ran `client.ts` and the step waited on, though the
assistant's context says running the client file passes the step.

- `run-call.ts`: the reading after the send moves to `fromSends`, which the
  run act and `readOutsideRun` share; the latter funds, stages and prints
  nothing, and reads nothing off devnet.
- `client-run-watch.ts`: `watchClientRuns(begin, port)` captures a `run`
  of the client file (`run` alone, or paths naming `client.ts`) from its
  start to its finish and reads it back; at the start it hands `pg.program`
  the deployed IDL, as the run act does. The run act's own
  run goes through `run` inside the act's capture, so its capture answers
  `CAPTURE_BUSY` and the watcher leaves it to the card.
- `reducer.ts`: `clientRunInput` is the live step's call or refused goal as
  a `RunInput`, null on any other step, once it passed, or while an act runs.
- `store.ts`: `PgConversation.watchClientRuns` hands the result to
  `passed("client", result)`, unless another tutorial opened, this one
  started over, or the cursor left the step meanwhile; the reducer judges it as any `passed`.
- `TutorialConversation.tsx` starts it with `realClientRuns()`, as it starts
  `watchDeploys`.
- Spec: a sentence and a scenario under "A step passes on what happened".

## No dead end (the user's rule, 11 Nov)

"Any card that requires an action that has a possibility to be failed needs
to show an appropriate retry button so there's never a dead end for the
user." The matrix of act × outcome → control is in the PR body and in the
table-driven test `never a dead end` in `view.ts`. Two cells were dead ends
beyond the run and call ones above:

- An unplanned build failure: Explain closed the card and "Show me the fix"
  wrote the lines, and "I'll fix it myself" only moved the caret; neither
  left a Build to press. `fixMyself` on a failed build now records
  `selfFixAt` (saved, parsed in `progress.ts`) and closes the card; once it
  is closed that way, or by Explain once the answer ended, `view.ts` posts
  "Build again" with `FIX_AND_BUILD` in the retry slot. A planned failure
  still goes to `onFail`.
- A run or call with no wallet: `BaseTxResultCard`'s "No wallet" card gets
  the deploy card's Create wallet, wired to the same `createWallet` handler.

## Refusals a retry cannot fix (round 3)

HOO-2356 left a TODO in `retryOf`: the deploy runner's immutable-program and
wrong-authority refusals were `failed`, so their only way on was Try again.

- `RunResult`: the deploy/airdrop failure gets `immutable` and
  `not_authority`; `blocker` in `runners/deploy.ts` returns them (the
  workspace without its keypair stays `failed`). `outcomeOf` reports both as
  `failed`, so `tutorial_action_run` keeps its values.
- `BaseDeployResultCard`: "Not upgradable" ("This program can no longer be
  upgraded, so the new code can't go to its address. Deploy it under a new
  program id: it builds again and ships to a fresh address.") and "Not your
  program" (the runner's line, then "Switch to the wallet that deployed it
  and press Try again, or deploy it under a new program id."), each with
  "Deploy under a new program id".
- The button (`newProgramId` in `TutorialConversation.tsx`) makes a new
  program keypair as the keypair panel's Generate does, clears the build id
  so the deploy builds again with the new `declare_id!`, and runs the act.
- `retryOf`: `not_authority` gets Try again with "Switch to the wallet that
  deployed it, then try again"; `immutable` none, the card's button is the
  way on.

## The run record through Zod (round 3)

`parseRun` in `progress.ts` reads the record's envelope with
`runRecordSchema` (a discriminated union on `status`): times are numbers,
and a failed run's `planned` and its moments (`explainedAt`, `answeredAt`,
`fixedAt`, `selfFixAt`) are each dropped alone when they do not read, as the
hand-written checks did. The result inside stays `parseResult`'s. Old saves
load unchanged; the parse test round-trips them.

## A learner's Stop (HOO-2822)

The matrix listed no Stop: a stopped build read as "Build failed", offered
Explain and "I'll fix it myself", and had no Build again until an answer
ended; the stop was reported as a fault.

- Detection is typed: `PgCommand.build` (the one stoppable command a tutorial
  act runs) ends a stop with `StoppedError` (`utils/stopped.ts`). `runBuild`
  answers it as `reason: "stopped"` and logs it at info; the deploy runner's
  build port carries it on as a deploy `stopped`. A `StoppedError` a
  deploy stage, a run or a call throws is `stopped` too, never reported;
  none can throw one today (`run` is not stoppable, a call and the chain
  stages run through no command), so those branches are guards.
- `RunResult`: `stopped` joins the build's, the deploy's and the run's or
  call's reasons; `isStoppedRun` reads it. `parseResult` keeps a saved
  build's `stopped` (it no longer reads as `compiler`); old saves load
  unchanged. `outcomeOf` reports it as `failed`, since the spec's outcomes
  name no stop.
- `view.ts`: a stopped result is never `open`; `retryOf` gives `stopped`,
  whose card is the act's own "again" (a build-and-deploy keeps its whole
  button) with "Stopped. Press <button> when you're ready.". The reducer's
  `explain` ignores it.
- `BaseStoppedCard`: one quiet row, "<act> stopped", drawn for every act by
  `BaseResultCard` and `BaseDeployResultCard`.
- Matrix rows: build (on the planned-failure step and while fixing), deploy,
  build-and-deploy, run and call, each stopped, in `never a dead end`.
