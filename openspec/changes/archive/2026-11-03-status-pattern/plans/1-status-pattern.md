# Plan: one status pattern (status-pattern 1.1–1.4, HOO-2483)

**Goal:** the network, the AI and the Rust analyzer show as one indicator
pattern on desktop, the rail and the phone (spec `client-v2-status`).

**Success metric (from the ticket):** On the preview, at desktop and at phone
width: disconnect the network or remove the AI key, and the status shows the
change in the same pattern. On a phone the chip shows the change and its
sheet names which part is down.

**Design gaps** (decided, ticket comment, sent to Design alignment): desktop
placement; network and AI clicks go straight to their fix, only the analyzer
opens a panel; "not answering" kept; rail = three dots; Reload for the
analyzer, 60 s mark; chip after the title in the phone bar.

## 1.1 Analyzer state

File: `src/components/Editor/Monaco/languages/rust/rust-analyzer/status.ts`.

- `AnalyzerState = {kind:"idle"} | {kind:"starting", since:number} |
  {kind:"ready"} | {kind:"failed"} | {kind:"off"}`.
- `PgAnalyzerStatus.get()`, `.set(state)`, `.onDidChange(cb)` → disposable
  (`useRenderOnChange`-compatible: calls `cb(state)` at once).
- `initRustAnalyzer`: `off` without isolation; `starting` before the worker;
  try/catch over the rest → `failed` (log, rethrow); `ready` after providers.
- Tests (in-source): set/get/notify, initial call, dispose stops calls.

## 1.2 Model (`src/widgets/status/model/`)

- `indicators.ts`: `StatusState = "ready"|"working"|"not-ready"|"idle"`;
  `StatusIndicator {id, name, state, words, label, detail, action}`;
  `networkIndicator({name, isConnected, slotStalled, online})`,
  `aiIndicator({model|null, online})`, `analyzerIndicator(state, now,
  online)`, `chipOf(indicators) -> {state, words}`; `SLOW_AFTER_MS = 60_000`.
  In-source tests for every row of the spec's words.
- `telemetry.ts`: `status_indicator_picked {indicator, state, from}`,
  `status_sheet_opened {worst}`; prefix `status` in `prefixes.ts`.
- `use-status.ts`: reads PgConnection (cluster, isConnected,
  isClusterDown), PgAssistant (connection, needsSignIn, onDidChange),
  PgSession.onDidChange, PgAnalyzerStatus, `online`/`offline` events, a 1 s
  tick only while the analyzer is starting.

## 1.3 UI (`src/widgets/status/ui/`)

- `BaseStatusIndicator`: button, StatusDot + words, `aria-label`, optional
  extra props (settings trigger attr), `variant: "row" | "rail"`.
- `BaseStatusRow`: three indicators in a wrapping row; the analyzer one
  wrapped in a Popover with `BaseStatusPanel` (title, words, detail, action).
- `BaseStatusRail`: three dot buttons (rail variant, tooltip = label).
- `BaseStatusChip`: chip button + bottom Sheet "Status" with three rows
  (dot, name, words, detail, action button ≥44 px).
- Connected: `StatusRow`, `StatusRail`, `StatusChip` take
  `{onOpenNetwork, onConnectAi}` and track events.
- Render tests (`*.test.tsx`): names and words per state, clicks call the
  right callback, events through `memoryProvider`.

## 1.4 Wiring

- `BaseSessionFooter`/`BaseRailFooter`: replace the cluster row with a
  `status: ReactNode` prop; `SessionFooter`/`RailFooter` pass it through;
  update their tests (the cluster row tests move to `widgets/status`).
- `BasePhonePager` + `LayoutShell`: optional `status` slot after the title.
- `Flow.tsx`: fill the slots with `StatusRow`/`StatusRail`/`StatusChip`.
- e2e `e2e/client-v2-status.e2e.spec.ts`: three indicators at 1440; AI off
  → Connect a model; offline and back; rail's three dots at 834; phone chip
  and sheet at 390.

## Gate

`yarn run check` + `yarn test-e2e e2e/client-v2-status.e2e.spec.ts` (and the
layout spec's cases that touch the cluster row, since the row moved).
