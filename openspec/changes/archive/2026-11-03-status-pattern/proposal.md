# Proposal

## Why

The network, the AI and the Rust analyzer each say whether they are ready in
their own way, or not at all: the network has a dot and a name in the
navigation's foot, the AI says nothing until a send fails, and the Rust
analyzer loads about 9 MB of WASM with no sign while the editor has no hints.
A slow first start then looks like a broken one. The designers' Spec 06 and
DES-194 ask for one status pattern, folded into one chip on a phone; Slava
put it in the Breakpoint scope on 2 Nov (HOO-2483).

## What Changes

- One status indicator: a dot and words, a button, in three states (ready,
  working, not ready), used for the network, the AI and the Rust analyzer.
- Desktop: the three indicators sit in one status row at the navigation's
  foot, where the cluster row was; the network indicator keeps the cluster
  row's name and still opens the settings on the cluster. The rail shows the
  three dots, one button each.
- AI: ready names the model; not connected, or the default backend while
  signed out, reads "AI · Off" and opens Connect a model.
- Rust analyzer: a state the UI can read: not started, starting (with the
  seconds so far), taking longer than usual after 60 s, ready, failed, or off
  where the browser cannot run it. Starting, slow and failed open a panel
  with what it means and a Reload action.
- Offline: while the browser has no connection, all three read "You're
  offline".
- Phone: one chip in the work page's bar shows the worst state ("Ready",
  "Starting", "<n> not ready"); a tap opens a sheet with the three rows, each
  with its words and its action.
- Telemetry, new slice `widgets/status`: `status_indicator_picked` and
  `status_sheet_opened`. The assistant's `assistant_connect_opened` gains
  `via: "status"`. No event is renamed or removed.

## Capabilities

### New Capabilities

- `client-v2-status`: the status of the network, the AI and the Rust
  analyzer: one indicator pattern, the desktop row and rail, the phone chip
  and sheet, and their events.

### Modified Capabilities

None. The cluster row keeps its name, its click and its "down" wording
(`ui-migration`'s layout requirement on the session footer); it now sits in
the status row.

## Impact

- `client-v2/src/widgets/status/` (new slice), `widgets/session-footer`
  (the cluster row gives way to a status slot), `widgets/layout-shell`
  (`BasePhonePager` gets a status slot in the work page's bar),
  `views/flow/Flow.tsx` (wiring), and the Rust analyzer's start
  (`components/Editor/Monaco/languages/rust/rust-analyzer/`) reports its
  state.
- Out of scope: `GET /ai/status` and the hosted daily cap ("Checking",
  "Limit reached"); the server-backed analyzer ("Reconnecting"); a Restart
  that restarts the analyzer worker in place (Reload reloads the page); the
  "not ready" announcement through a live region beyond each button's name;
  the design-system registry entry (Almaz reviews after the freeze); the
  offline line over the stage (Spec 08).
