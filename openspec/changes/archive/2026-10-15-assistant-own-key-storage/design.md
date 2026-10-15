# Design

## Context

`PgAssistant` (`views/sidebar/assistant/store.ts`) holds the connection in
memory. `model/remembered-backend.ts` writes one value, `assistant.backend`, to
`localStorage`, and only the keyless default backend is ever "remembered"
there; `Connect.tsx` reconnects to it once the probe of `/api/agent` confirms
the deployment serves one. Every other backend is lost on reload.

The key already travels the way the ticket asks: the Anthropic SDK sends it as
`x-api-key` (`dangerouslyAllowBrowser`), `openai.ts` as
`Authorization: Bearer`, both straight to the provider. `/api/agent` runs on the
server's own key and takes none from the client. `paramsOf` already strips the
key from what a thread records.

## Goals / Non-Goals

**Goals:**

- A reload of the tab reconnects a key-based backend with no typing.
- The decision, its reason and its residual risk are recorded here, with the
  change.

**Non-Goals:**

- Protecting the key from code running in the same origin (see Risks).
- Any change to how requests carry the key.

## Decisions

### Decision: `sessionStorage`, not `localStorage` (Slava, 2026-10-13)

Project code, including code from a project someone shared, runs in the same
origin behind a string blacklist, so anything the page stores is within its
reach. `localStorage` would keep the key there indefinitely, across tabs and
restarts. `sessionStorage` keeps it for the life of one tab: the window in which
a shared project could read it is the window in which the user is already
working with that key. The cost is typing the key again in a new tab.

Alternatives: memory only (what step 1 shipped; safest, re-entered on every
reload, the problem this ticket exists for); `localStorage` (most convenient, longest
exposure; rejected); encrypting at rest (the page must hold the decryption key,
so code that can read storage can decrypt; adds nothing).

### Decision: extend `remembered-backend`, one module for "what to reconnect"

`rememberBackend` takes the whole `Connection` instead of an id. Every backend
writes its id to `localStorage` under `assistant.backend`, as the default
already did; a key-based backend's id overwrites the default's there, so
`isDefaultBackendRemembered` answers false, and it also writes the connection as
JSON to `sessionStorage` under `assistant.connection`. `forgetBackend` clears
both. A new `rememberedConnection()` returns the stored connection only if it
parses, names a known key-based provider, has a key (blank only where the
provider's key is optional), and carries an endpoint exactly when the provider
has one; anything else is dropped, logged by a reason code, and treated as
absent. `toStored` and `fromStored` copy every field of `Connection` through a
type that makes each one required, so a field added to `Connection` fails the
build until it is kept. Keeping both in one module keeps the rule "which backend comes back on
reload" in one place, and `store.ts` keeps calling the same two functions.

Alternative: a separate `remembered-key` module. Rejected: two modules would
each have to know about the other's key to clear it on a switch.

### Decision: reconnect before the probe

`Connect.tsx` reconnects a stored key-based connection on mount, without waiting
for the `/api/agent` probe, which only matters for the default backend. The
guards the default's reconnect already had apply: nothing already connected,
the picker not open on purpose. Running first is also what makes it win over a
remembered default; `Component/Connect.test.tsx` pins that order.

### Decision: Forget key in the chat header

`PgAssistant.disconnect` had no control in the UI. A Forget key button beside
Change in the chat header calls it, shown only while the connection is to a
provider that `needsKey` and disabled during a turn, like Change. If the key
could not be removed, `disconnect` shows a notice to close the tab; the notice
stays in memory and is not written to the stored thread.

### Decision: storage failures are logged, never fatal

Every storage access stays in `try/catch`, but the `catch` logs through
`shared/lib/logger` with a message that names the operation and never the value.
Not `report: true`: storage refused with site data blocked is expected, not a
fault the team must hear about.

One exception. Every path that must lose the key goes through `dropKept`, which
blanks the entry when removing it throws. If a read-back after that still finds
a non-empty value, the key verifiably survived, which is a privacy failure, and
that one case is logged with `report: true` (by what failed, never with the
value). Storage that refuses the read-back too never held the key, so it is
only logged.

### Decision: Redact the key from provider errors

A provider's error can quote the key it rejected, and an error becomes an item
in a thread that is persisted and synced. `model/redact-key.ts` replaces the
exact key with `[your key]` wherever provider text becomes an item:
`PgAssistant.addError`, and the error body `model/openai.ts` quotes, which is
redacted before it is cut to 300 characters so a cut through the key cannot
leave its head behind. Only the exact key is matched. A key shorter than
`MIN_REDACTED_KEY_LENGTH` (8) is left alone: it is a placeholder for a local
proxy that checks none, and replacing it would mangle ordinary words in the
error text.

## Risks / Trade-offs

- [Same-origin code can read the key while the tab is open] → accepted by the
  decision above; the built-in wallet has the same exposure and is tracked
  separately. The docs say so plainly.
- [A stored connection names a provider removed in a later release] →
  `rememberedConnection` drops an unknown id; the user sees the picker.
- [A logger or error report captures the key by accident] → no code path logs a
  `Connection`; a unit test asserts the logged arguments of a failing write do
  not contain the key.
- [A tab the browser duplicates or restores carries `sessionStorage`, so it
  keeps the key and reconnects] → accepted, and stated in the Connect note,
  `remembered-backend`'s header and `docs/assistant-context.md`. Every browser
  copies `sessionStorage` into a duplicated tab; Firefox also restores it when it
  reopens a closed tab or restores a session (Bug 1198772). Either way the tab
  is one the user was already working in with that key.

## Migration Plan

None. Existing users have no stored key; the `assistant.backend` value keeps its
meaning. Rollback is a revert; a stored `assistant.connection` is then ignored
and dies with the tab.
