# Design

## Context

The navigation's foot (`widgets/session-footer`) draws the cluster row, a
`StatusDot` and the cluster's name, which opens the settings on the cluster;
the rail draws the same dot. The AI's state is `PgAssistant.connection` and
`needsSignIn`. The Rust analyzer starts on the first Rust model
(`Monaco.tsx`'s `onLanguage`) and retries its worker every 10 s
(`PgCommon.tryUntilSuccess`) with nothing the UI can read. The phone's work
page has a bar (`BasePhonePager`'s `PhoneBar`): Menu, the title, Chat |
Code and Preview.

Design sources, in their order of weight: the DS prototype draws only the
cluster row ("● Devnet") at the foot and no status on the phone; Almaz's
stand draws the same; the designers' Spec 06 (Indicators, On a phone, States,
Copy) is the only source for three indicators, a chip and a sheet.

## Goals / Non-Goals

**Goals:** one indicator pattern for three sources; the chip and sheet on a
phone; an analyzer state; nothing the existing cluster row promises breaks.

**Non-Goals:** a live AI status endpoint; restarting the analyzer worker in
place; the design-system registry entry.

## Decisions

- **The pattern is a model, not three widgets.** `widgets/status/model`
  turns raw inputs (cluster, connection, AI, analyzer, online) into three
  `StatusIndicator` values `{ id, name, state, words, label, detail?,
  action? }`, and `worst()` into the chip's words. Every view (row, rail,
  sheet) draws only those values, so the pattern cannot drift between them.
  Alternative: one component per source; rejected, it is how the three
  diverged.
- **The network indicator keeps the cluster row's contract.** Its name,
  `data-settings-trigger`, its click (settings on the cluster) and the focus
  return stay; it only gains "connecting". Spec 06 has a press open a short
  panel first; that would break the session-footer requirement and a dozen
  e2e cases for one extra click before the same settings. AI keeps the same
  shape: its click goes straight to where it is fixed, Connect a model. Only
  the analyzer, which has no settings of its own, opens a panel (Popover).
- **One row that wraps.** Three indicators in a 230 px foot do not fit with a
  long state; the row wraps instead of truncating the words a state needs.
- **The analyzer reports through a small store beside it.**
  `rust-analyzer/status.ts` holds the state and an `onDidChange` event; the
  start sets `starting` before `tryUntilSuccess`, `ready` after the providers
  register, `failed` in a catch around the rest, `off` without cross-origin
  isolation. "Taking longer" is derived in the model from `since` and a 60 s
  mark, so the store never runs a timer. Reload is `location.reload()`: the
  worker cannot be torn down mid-`tryUntilSuccess` today.
- **The slots stay in the layout.** `session-footer` and `layout-shell` take
  a `status` node; `Flow` composes `widgets/status` into them, since one
  widget does not import another.
- **Offline is `navigator.onLine` plus its events**, read in the hook.

## Risks / Trade-offs

- [The phone bar is tight at 320 px] → the chip is a dot and one or two
  words; the title truncates first.
- [The model name is long] → it truncates inside its indicator; the full
  name is in the button's name and title.
- [Analyzer "ready" is when providers register, not when crates finish] →
  acceptable: hints start working from then.

## Migration Plan

None; client-only, no stored state.
