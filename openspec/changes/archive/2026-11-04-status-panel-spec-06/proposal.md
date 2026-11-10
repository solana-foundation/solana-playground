# Proposal

## Why

The status pattern from HOO-2483 shows three of Spec 06's states only in
part. A cluster that does not answer can only be changed, not asked again,
from the indicator. The AI indicator never reads "Checking" while the app
finds out whether a hosted model is there, and it says nothing when the free
daily limit is spent: the user learns it only from a failed turn in the
thread. HOO-2582 is the follow-up the 4 Nov copy diff (HOO-2434, second pass
on SF#74) filed.

## What Changes

- A network indicator whose cluster does not answer opens a panel when
  pressed (status row and rail), with the cluster line and two actions: "Try
  again", which asks the cluster again and stays busy while it asks, and
  "Change network", which opens the settings on the cluster. A ready or
  connecting network still opens the settings at once. The phone sheet's
  network row shows both actions.
- The AI indicator reads "AI · Checking" (working) while nothing is
  connected and the app is still asking the deployment whether it serves a
  hosted model.
- The AI indicator reads "AI · Limit reached" (waiting, the warning dot)
  once the hosted model has refused a turn under its daily cap or its spent
  pool. Its panel says "The free daily limit is used. It comes back at
  <HH:MM>, or add a key of your own to keep going." with the action "Add an API key", which opens Connect a
  model. The phone chip counts it as not ready.
- The limit reading clears at the next 00:00 UTC, when another backend is
  connected, and when the backend is forgotten.
- The AI indicator reads "AI · Not responding" (failed, red) while
  nothing is connected and that asking failed online, with a panel offering
  "Try again" and "Add an API key" (design alignment, 4 Nov, from HOO-2577).
- Telemetry: one new event, `status_retried`, when a user's Try again on
  the network's or the AI's panel or sheet row finishes asking. No event is
  renamed or removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-status`: the network indicator's Try again panel, the AI
  indicator's Checking and Limit reached states, and the new event.

## Impact

- Code: `client-v2/src/widgets/status` (indicators, row, rail, sheet,
  telemetry), the assistant store (`views/sidebar/assistant/store.ts`) for
  the limit and checking readings, the default backend's refusal handling
  (`views/sidebar/assistant/model/provider.ts`) and the default-backend probe
  (`widgets/assistant/model/default-backend.ts`).
- Out of scope: the network's word for a cluster that does not answer. Spec
  06 says "Unreachable"; design alignment on 4 Nov kept the prototype's "not
  responding" (PR #282 on `scope/interface`), and this change leaves the word
  as its base branch has it. Also out of scope: knowing the limit before a
  refused turn or after a reload. No endpoint reports the remaining
  allowance, so the indicator reads it from the last refusal in this tab.
- No backend change.
