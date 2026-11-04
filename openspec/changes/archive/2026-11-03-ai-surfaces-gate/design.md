# Design

## Context

`widgets/assistant/model/default-backend.ts` asks `GET /api/agent` once per
page (again only after a failure) and answers `checking | absent |
unreachable | present{model}`. The composer, the head, the model menu,
Connect a model and `useTurn` read that answer; each pairs it with
`PgSession` for "signed in". `GET /api/ai/status` (change
`ai-status-endpoint`) answers per caller: `{ available, key, reason, model }`.

The composer already blocks Send with "Connect a model to send" when the
answer is `absent`, and shows a "prompt is waiting" callout after a send it
could not deliver. Nothing tells a signed-out user, before they type, that
the hosted model needs sign-in, and an unreachable model keeps Send enabled.

No design source draws an off state: the DS prototype and Almaz's stand show
a working assistant only. The designers' Spec 06 says the composer stays
visible and its top row says the AI is off; Spec 07 gives the no-key copy;
Spec 04 the unreachable copy. This design follows them.

## Goals / Non-Goals

**Goals:** one source for "is a hosted model offered"; an off state that is
visible before anything is typed and names its way in.

**Non-Goals:** the navigation's status indicator (HOO-2483 may read the same
probe later); the daily cap; retiring `GET /api/agent`'s probe.

## Decisions

1. **Swap the probe's source, keep its shape.** `probeDefaultBackend` reads
   `/api/ai/status` and maps it onto the same `DefaultBackend` union, so every
   reader keeps working. `key: "hosted"` → `present{model}`, `key: "own"` or
   `404` → `absent`, `reason: "unavailable"` → `unreachable` (a failure, so
   the next caller asks again). Alternative: make the union per caller
   (`signed-out` as a state) and drop `PgSession` from the readers. Rejected
   for now: the answer would go stale on every sign-in and sign-out, so the
   once-per-page cache would have to be keyed by session, and five readers
   would change for no visible gain; `PgSession` reads the same cookie the
   route does.
2. **The off row is derived, not stored.** `aiOff({ connected, backend,
   signedIn })` in `widgets/assistant/model`, with `connected` the connected
   provider or `null`, returns `null | "no-key" | "signed-out" |
   "unreachable"`; the composer renders the row and Send's
   tooltip from it. The row is a design-system `Callout` with buttons, in
   `AssistantComposer` (connected) over `BaseAssistantComposer`, which keeps
   taking `sendBlocked` as a string.
3. **Add a key goes where a send would.** It calls `useTurn`'s existing
   resolution (`resolveSendBackend`): a thread last answered by a key-based
   backend opens Connect preset to it, otherwise Connect a model opens plain.
   So HOO-1719's rule (never continue a key-based thread on the hosted
   model) holds from the row too.
4. **Try again resets the probe.** A `retryDefaultBackend()` drops the cached
   answer and re-asks; a second press joins the retry under way.
   `useDefaultBackend` subscribes to answers, so every reader updates, and
   only the latest request's answer is handed out: an earlier request that
   settles after a retry never overwrites it.
5. **Entry points outside the panel stay mounted.** They already place a
   prompt in the composer when it cannot be sent; the row now explains why.
   Hiding them would hide the one route to the explanation.

## Risks / Trade-offs

- [Eleven e2e specs stub `**/api/agent` for the probe] → they move to a
  shared `stubAiStatus` fixture in the same PR; the turn's `POST /api/agent`
  stubs stay.
- [A deployment older than HOO-1746 has no `/api/ai/status`] → `404` reads
  as no hosted model, so such a deployment offers only a key of one's own.
  All deployments built from this branch carry the route.
- [Signed-in-ness from `PgSession`, availability from the route] → both read
  the same session cookie; a server that cannot read it answers
  `unavailable`, which reads as unreachable rather than signed out.
