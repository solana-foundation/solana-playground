# HOO-2675: a run or call devnet has not read back is unconfirmed, not refused

Bug ticket, inline. Ticket: https://linear.app/solana-fndn/issue/HOO-2675.
Base `scope/tutorial-flow`.

## Goal

A run or call whose transaction was sent but not read back from devnet in
the read window posts "Not confirmed yet", not "Call failed". "Check again"
reads the same signatures again without sending; if they landed, the result
is the landed one and the goal is judged on it.

## Shape

- `progress.ts`: `UnreadTx = { signature, calls, undecoded? }`; the run/call
  `ok: false` variant takes `reason: "unconfirmed"` and `unconfirmed: UnreadTx[]`
  (every transaction the run sent, in order, not only the unread ones, so a
  re-read rebuilds the whole result).
- `transactions.ts`: `SentTx` gains `kind: "unread"`. `resultOf`: a refusal or
  an error still wins; else any unread transaction makes the unconfirmed
  result.
- `ports.ts`: `RunInput.recheck?: UnreadTx[]`.
- `run-call.ts`: with `recheck`, no funding and no send: one "Confirming"
  stage, each signature read with `port.landed`, then the same `resultOf` and
  account read as a fresh run.
- `reducer.ts`: the `act` action takes `recheck?: true`; it starts a run only
  when the beat's last run failed unconfirmed, with `input.recheck` from it.
- `store.ts`: `PgConversation.recheck(beatId)`.
- Card (`BaseTxResultCard`): "Not confirmed yet", muted (not red), meta
  "· <short signature> ↗" and no words, where the last sent signature is
  the Explorer link (no separate Explorer button, design alignment 6 Nov;
  no reason words beside it, 7 Nov), the message as its body, and "Check again" while the
  card is open; ⌘↵ on it checks again, and Explain has nothing to explain.
  A check that cannot read (wrong network, a throw) stays unconfirmed with
  the reason as its message; a run that threw after sending fails with the
  throw.
- Telemetry: `outcome: "unconfirmed"`.
- Spec: a sentence and a scenario under "Client runs and calls send real
  transactions".

## Steps (TDD)

1. `resultOf` unread → unconfirmed; refusal still first.
2. `runOrCall` read failure → unconfirmed; recheck re-reads without send and
   passes; recheck still unread stays unconfirmed.
3. Reducer: recheck after unconfirmed starts a run with `input.recheck`; a
   recheck with no unconfirmed run does nothing; a later landed read passes
   the goal.
4. Card test: title, Check again calls back, no red.
5. Telemetry outcome, spec text, `yarn run check`.

## Design gaps

No design source draws an unconfirmed transaction. Decided: the
"No transaction" card's muted look, title "Not confirmed yet", one Check
again button. Sent to the designers' batch.
