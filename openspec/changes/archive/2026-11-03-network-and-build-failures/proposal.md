# Proposal

## Why

The copy diff against the designers' specs (HOO-2434, 3 Nov 2026) found three
failure states from Spec 08 that client-v2 does not draw at all: an unmapped
build failure hides its log behind "Show details", going offline shows only in
the status indicators, and a cluster that stops answering has no line where
Deploy and Interact wait for it. HOO-2523 builds them before Breakpoint.

## What Changes

- **Show full log (Spec 08 ANY-00).** A build that fails before the compiler
  for a reason the product cannot name offers "Show full log" as its secondary
  action, which opens the console drawer (a sheet on a phone) where the
  terminal holds the whole output. "Show details" stays only on BUILD-04 (the
  build server did not answer), as Spec 08 has it.
- **Offline (Spec 08 NET-01).** While the browser is offline, one line over
  the stage says "You're offline. Editing still works. Build, Deploy and the
  assistant need a connection." (Spec 08's line, with "the assistant" for its
  working name Program Pal), the phone's status chip reads "Offline"
  instead of "3 not ready", and the Build stage's Build buttons wait
  (disabled). The indicators' offline line takes the same words, replacing
  Spec 06's "You're offline. You can keep editing. Building needs a
  connection." so one cause says one thing.
- **Network not answering (Spec 08 NET-02).** On the Deploy and Interact
  stages, while the cluster does not answer, a warning line says "<Network>
  isn't answering. Playground keeps trying. You can switch network." with
  "Try again" (asks the cluster again now) and "Change network" (opens the
  settings at the network).
- **Telemetry (widgets/status):** adds `status_notice_shown` (a notice
  appears, once per onset) and `status_notice_action` (Try again or Change
  network pressed on a notice). No event is renamed or removed.

## Capabilities

### New Capabilities

- `client-v2-failure-states`: the Build stage's failure surfaces that name a
  log, starting with Spec 08 ANY-00's "Show full log".

### Modified Capabilities

- `client-v2-status`: the offline line's words, the phone chip's offline
  reading, the stage notice for offline and for a cluster that does not
  answer, and the slice's two new events.

## Impact

- `client-v2/src/widgets/status` (new `StageNotice` pair, indicators, events),
  `client-v2/src/views/flow/Flow.tsx` (mounts the notice over the stage),
  `client-v2/src/views/flow/stages/BaseBuild.tsx` and `Build.tsx` (Show full
  log, Build waits offline), `client-v2/src/widgets/layout-shell` (a request
  to open the console), `client-v2/src/utils/connection.ts` and `ask-again.ts`
  (a manual re-check for Try again).
- Out of scope: the other Spec 08 states that name a log (BUILD-06, BUILD-07,
  DEPLOY-07, INTERACT-01), scrolling the drawer to the failed run and
  highlighting its line, NET-03/NET-04, the chip words "Not answering" vs
  Spec 08's "not responding" (wording, HOO-2434's), and disabling Deploy and
  Interact while offline or while the cluster is down (Spec 06 RUN-27).
