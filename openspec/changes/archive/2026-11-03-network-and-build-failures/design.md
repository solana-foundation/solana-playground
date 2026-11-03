# Design

## Context

HOO-2483 (#242) gave the network, the AI and the Rust analyzer one status
pattern in `widgets/status`: offline and "not answering" already read on the
indicators, with a panel line and "Change network". What is missing is where
work waits: nothing over the stage, nothing on Deploy or Interact, and the
Build stage's ANY-00 hides the log behind a "Show details" collapsible that
only names the server. The console drawer exists (`views/flow/console`), and
the layout shell already opens it by itself when a deploy starts or fails.

Design sources, in the method's order: the DS prototype and Almaz's stand
draw none of these states, so the designers' Spec 08 leads, with Spec 06 for
the indicators.

## Goals / Non-Goals

**Goals:**
- One notice component over the stage that owns both NET-01 and NET-02, so
  one cause shows once (Spec 08, "One cause, one message").
- "Show full log" reuses the shell's own opening of the console, phone sheet
  included.

**Non-Goals:**
- Scrolling the terminal to the failed run or highlighting a line: the
  terminal has no run markers, and the failed build is its last output.
- Disabling Deploy and Interact while the cluster is down (Spec 06 RUN-27):
  those stages belong to the users'-work scope.
- Gating the other ways a build starts offline (the explorer's context menu,
  Deploy's build first, the assistant): only the Build stage's buttons wait.
  A build started another way offline fails as before, under the offline
  line.

## Decisions

- **The notice lives in `widgets/status` as `BaseStageNotice` +
  `StageNotice`.** It reads the same inputs as the indicators (`useOnline`,
  `PgConnection.isConnected`, `isClusterDown`) through the same
  `networkIndicator` reading, so the indicator and the notice can never
  disagree. Flow mounts it between the lesson band and the stage router, and
  passes the stage and the "open settings at the network" callback it already
  has for the indicator. Alternative: a notice inside each stage, rejected
  because three stages would each repeat the same reading.
- **Opening the console from a stage goes through the layout shell.**
  `widgets/layout-shell` exports `requestConsole()`; the shell subscribes and
  runs its existing `openConsole` (saved state on wide, the visit's sheet on
  a phone, nothing under Home or a page). Alternative: lifting the console's
  open state into a store, rejected as a larger change of a widget other
  tickets touch.
- **Try again is `PgConnection.recheck()`.** It fires a manual trigger
  (`utils/ask-again.ts`) that the `isConnected` and `isClusterDown`
  derivables listen to, and takes the same two readings itself, awaited, so
  the AsyncButton is busy until the slower stall check ends. It resolves to
  whether the cluster answered with a moving slot; when it did not, the press
  fails and the button's own failure toast says "Could not reach the
  network." The polls compare against the derived value rather than a copy
  of their own, so a value Try again derived in between is the one they see.
- **One offline line.** `OFFLINE_LINE` takes Spec 08's NET-01 words, which
  name Deploy and the assistant as well as Build ("the assistant" for the
  spec's working name Program Pal, as Spec 04 says the UI does; Design
  alignment, 3 Nov 2026); Spec 06's shorter line is replaced, not kept beside
  it. The conflict goes to the designers' batch.
- **"Change network", not Spec 08's "Switch network".** The indicator's
  action, Spec 06 and the ticket all say "Change network"; one button name
  for one action. Flagged to the designers' batch.
- **Build waits offline by being disabled**, with the notice over the stage
  saying why (Spec 08 ERR-23: "Build waits and says why. No retries run.").

## Risks / Trade-offs

- [`navigator.onLine` is true behind a captive portal or a dead Wi-Fi] →
  the cluster notice still shows on Deploy and Interact from the RPC probe;
  Build fails as before.
- [Try again adds one `getSlot` on top of the derivable's own] → only on a
  user's press, never polled.
