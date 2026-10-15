# Proposal

## Why

A user who runs the assistant on their own API key (Anthropic, an
OpenAI-compatible endpoint, OpenRouter, Gemini) types it again after every
reload, because the key lives only in memory. That is the main friction of the
bring-your-own-key path, and it is step 2 of HOO-1748; step 1 kept the key in
memory on purpose until the storage question was decided. Slava decided it on
2026-10-13: `sessionStorage`, not `localStorage`.

## What Changes

- The connection to a key-based backend (provider, key, base URL, model,
  effort) is kept in the tab's `sessionStorage` when the user connects, and the
  panel reconnects to it by itself after a reload of that tab.
- A new tab asks for the key again: `sessionStorage` is per tab. A tab the
  browser duplicates or restores reconnects with the key, as after a reload.
- Disconnecting, through a Forget key button in the chat header, or switching
  to the keyless default backend, removes the stored connection.
- The key is never written to `localStorage`, IndexedDB, a synced thread, the
  server, a log line, a telemetry event or an error report.
- Unchanged and recorded as such: the key already goes straight from the
  browser to the provider as a header on every request (`x-api-key` for
  Anthropic, `Authorization: Bearer` for the OpenAI-compatible providers) and
  never reaches our origin. Nothing is built for that part of the ticket.
- The default backend's remembered choice keeps working as before.
- Telemetry: the assistant panel lives in the legacy `views/` root and is not a
  slice under `features/` or `widgets/`; this change adds, renames and removes
  no events.

## Capabilities

### New Capabilities

- `assistant-own-key`: how the assistant keeps, reuses and forgets the API key
  a user supplies for a key-based backend.

### Modified Capabilities

None.

## Impact

- Code: `client-v2/src/views/sidebar/assistant/model/remembered-backend.ts`,
  `store.ts` (`connect`, `disconnect`), `Component/Connect.tsx` (reconnect on
  load), `Component/Chat.tsx` (the Forget key button), `model/redact-key.ts`
  (the key redacted from provider errors, in `store.ts` and `model/openai.ts`),
  comments in `model/anthropic.ts` and `model/openai.ts` that say the key is
  never persisted.
- Docs: `docs/assistant-context.md` (key handling), copied into the panel with
  `yarn sync-assistant-context`.
- Tests: unit tests beside `remembered-backend.ts` and `store.ts`; Playwright
  scenarios in `e2e/assistant-reconnect.e2e.spec.ts`.
- User-visible: a reload no longer asks for the key; a new tab still does.
- Out of scope: the built-in wallet's keypair, which has the same same-origin
  exposure and is tracked separately; any server route that would accept the
  user's key; encrypting the stored key (a key the page can decrypt is readable
  by the same code that could read it in the clear); remembering the key across
  tabs or browser restarts by design (a restored tab carries it only because
  the browser restores its `sessionStorage`).
