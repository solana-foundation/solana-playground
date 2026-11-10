# Design

## Context

`widgets/status` builds each indicator as a plain view model
(`model/indicators.ts`) from live inputs (`model/use-status.ts`), and three
views draw it: the status row, the rail and the phone sheet. Until now only
the Rust analyzer opened a panel; the network and the AI acted straight away
(HOO-2483, design-gap decision 2). The stage notice already has "Try again"
for a cluster that does not answer, on `PgConnection.recheck`.

The AI input reads only `PgAssistant.connection`. The hosted model's daily
cap reaches the client as a refused turn (`TurnFailure` with reason
`capped`, from `profile.backendRefusal` in `provider.ts`). Whether the
deployment serves a hosted model is asked once per page by
`probeDefaultBackend` in `widgets/assistant`.

## Goals / Non-Goals

**Goals:** the three Spec 06 states with their actions, in all three views,
drawn from one view model.

**Non-Goals:** a status endpoint for the allowance; changing the network
word; a panel for states that have nothing to add (ready, connecting, off).

## Decisions

- **A panel only where there is something to say or retry.** The indicator
  model gains `panel: boolean`; the row and the rail open a popover when it
  is true and act at once otherwise. True for the analyzer always, the
  network while not ready and online, and the AI at Limit reached and at Not
  responding.
  Alternative: a panel on every press (Spec 06's literal reading). Rejected:
  it adds a click to the common path and undoes the HOO-2483 decision the
  designers have not answered yet.
- **Try again is a second action, not a new `StatusAction` in the one
  slot.** The model gains `retry: boolean`; `StatusDetail` draws an
  `AsyncButton` "Try again" before the action when it is set. The press calls
  `PgConnection.recheck` and fails with "Could not reach the network." when
  the cluster still does not answer, as the stage notice does.
- **The limit lives in the assistant store, as a time and a user.**
  `PgAssistant` holds the next 00:00 UTC after a capped refusal, set where
  `provider.ts` raises it, with the user it refused, because the allowance is
  per user; connecting a different backend and `disconnect` clear it. Both
  refusal reasons reset at that time (`REFUSAL_MESSAGES`), so the panel's time
  holds for a spent pool too. The indicator compares the time with now, and a
  timer emits at that moment: nothing else renders the status in a tab left
  open past midnight, and it read Limit reached until something unrelated did.
- **Try again on the AI asks the probe again.** Flow passes `onRetryAi`,
  which calls `probeDefaultBackend` (a failed probe is not cached), because
  the status widget cannot import `widgets/assistant`.
- **Checking and Not responding come from the probe.** The probe module publishes where it
  stands (`unasked`, `checking`, `unreachable`, `answered`) through
  `PgAssistant.setDefaultProbe`; the AI
  input reads it only while nothing is connected. The status widget
  cannot import `widgets/assistant` (one widget never imports another), and
  it already reads the assistant store.

- **Asking again stays Not responding until it hears back.** Checking has no
  panel, so going back to it would unmount the Try again that asked, with its
  busy state and its failure line.
- **The check gets 10 s.** A hung request would read Checking for the page's
  life. A deployment slower than that reads Not responding, and the next send
  or Try again asks again.

## Risks / Trade-offs

- [A reload forgets the limit] → the next turn is refused again and sets it;
  noted as a design gap for the designers.
- [Checking flashes on every load] → it lasts as long as one GET; it is the
  state Spec 06 asks for.
