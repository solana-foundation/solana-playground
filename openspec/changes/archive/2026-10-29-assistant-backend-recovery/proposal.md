# Proposal

## Why

A key-based connection lives only in its tab (HOO-1748), so a new tab or a
browser restart loses it. The first send after that connects the deployment's
default backend and silently continues a thread the user was having with
their own model, and connecting their own model back then clears the thread
on screen. HOO-1719: a thread survives losing its key.

## What Changes

- A send with nothing connected no longer falls back to the default backend
  when the open thread was last answered by a key-based backend. It opens
  Connect a model preset to that backend (provider, model, base URL, effort,
  never the key), and the typed prompt waits in the composer as today.
- A thread with no reply yet takes the backend this browser last chose. The
  remembered choice in `localStorage` grows from the provider id to the
  provider, model, base URL and effort; the key stays in the tab's
  `sessionStorage` only.
- Connecting or switching a backend no longer clears the conversation on
  screen: the new backend is seeded from what is rendered, as a reload already
  does. The note "Switching starts a new conversation. The current one cannot
  be replayed to another backend." is removed, and the comments that say a
  switch starts a new conversation are corrected.
- A turn the provider refuses with 401 ends in an error naming the
  backend, with an **Enter key** button that opens Connect a model preset to
  that backend.
- Telemetry (`widgets/assistant`): `assistant_connect_opened.via` gains
  `"thread"` (a send reopened the thread's own backend) and `"key-rejected"`
  (the Enter key button); a new event `assistant_key_rejected` fires when a
  turn ends on 401. No event is renamed or removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assistant-own-key`: a thread keeps its backend across a lost key, a switch
  keeps the conversation, a rejected key offers re-entry, and the remembered
  choice carries the non-secret parameters.

## Impact

- `client-v2/src/widgets/assistant/model/use-turn.ts` (the send path and the
  prompt request path), `widgets/assistant/model/telemetry.ts`.
- `client-v2/src/views/sidebar/assistant/store.ts` (`connect`, the error
  item), `model/remembered-backend.ts`, `Component/Connect.tsx`
  (`ConnectPreset`, the switching note).
- The error item's **Enter key** button has no design; it uses the design
  system's existing button and goes to Design alignment as a visible gap.
- Out of scope: a model badge on each reply (a question for the designers);
  sharing one full transcript, tool calls included, across backends
  (HOO-1752, which also stops the clear on switch; whichever merges first
  carries that part); any server change; storing the key anywhere new.
