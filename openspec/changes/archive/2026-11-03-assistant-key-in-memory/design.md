# Design

## Context

`remembered-backend` keeps two answers: the backend's parameters without the
key in `localStorage` (`assistant.backend`, read by `rememberedChoice` and
`isDefaultBackendRemembered`), and the whole key-based connection, key
included, in `sessionStorage` (`assistant.connection`), which `useTurn`
reconnects on mount. `PgAssistant.disconnect` (Forget key) drops both and
clears the on-screen thread. The send path already handles "nothing
connected, a key-based backend remembered": `resolveSendBackend` opens
Connect a model preset to the thread's backend or the remembered choice
(HOO-1719). So taking the key out of storage needs no new reconnect logic,
only one addition: Connect a model opened from the composer or the head with
nothing connected starts on that same backend, since a send is disabled
until something is connected and that button is how a reload asks for the
key.

## Goals / Non-Goals

**Goals:**

- No code path writes the key to browser storage.
- One action, one name: Delete my key, from Settings and from the head.

**Non-Goals:**

- Keeping the key away from scripts on the origin while the page lives
  (HOO-2426, the iframe on a separate origin).
- The designers' Settings key field (Save, masked last four).

## Decisions

- **Stop writing, keep a one-time cleanup.** `rememberBackend` writes only
  the parameters. The `sessionStorage` entry is removed, through the
  existing `dropKept` (remove, else blank, report only a key that verifiably
  survived), on the first `useTurn` mount and by every forget. Alternative:
  leave old entries to die with the tab. Rejected: a tab open across the
  deploy would keep the key in storage until it closes, which is what the
  review objected to.
- **Delete my key is `PgAssistant.disconnect`.** The Settings button and the
  head item call the same method, so both drop the key, the remembered
  choice and the on-screen thread, and keep the stored conversation.
  Alternative: a separate `deleteKey` that keeps the remembered choice so
  Connect a model is preset. Rejected for now: two actions under one name
  would differ in a way the user cannot see.
- **The Settings section reads the store directly.** `settings-page` is a
  widget and may import the legacy `views/sidebar/assistant` store and its
  `PROVIDERS`; it subscribes with `PgAssistant.onDidChange`. "Busy" is
  `PgAssistant.status !== "idle" || PgAssistant.turnRunning`, the store's
  own view of a turn using the key.
- **No confirm dialog.** The key can be typed again, and the head's item
  never had one. The designers' spec lists sign out, remove wallet, reset
  and clear data as the destructive actions that confirm; the key is not
  among them.
- **Two events, one per slice.** Each widget measures its own surface
  (`settings_key_deleted`, `assistant_key_deleted`); a widget cannot import
  another widget's tracker.

## Risks / Trade-offs

- [A reload now costs the user their key] → Connect a model opens preset
  on the next send, so only the key is typed again; this is the review's
  explicit ask.
- [A restored tab after the deploy still holds the old entry until the
  assistant mounts] → the panel mounts on every load of the IDE route; the
  entry lives no longer than that first mount.

## Migration Plan

Ships with the code; no data step. Rollback restores the `sessionStorage`
write; no entry written by this build needs reading back.
