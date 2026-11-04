# Proposal

## Why

The client has no single answer to "can this person use AI here, right now".
`GET /api/agent` says whether the deployment serves a default backend, but not
whether the caller may spend it: a signed-out visitor sees a live-looking
assistant that refuses their first question. HOO-1747 gates every AI surface on
one answer, so the server has to give it, per caller (HOO-1746).

## What Changes

- New route `GET /api/ai/status`. It answers, for the caller, whether an AI key
  is available, whose key it would be (the deployment's hosted key, or the
  user's own from settings), why a hosted key is not usable yet (signed out, or
  the session lookup failed), and the hosted model's id.
- The answer never holds the key or any part of it, and is never cached
  (`Cache-Control: no-store`), since it depends on the caller's session.
- Only `GET` and `HEAD` are served; any other method is a `405`.
- `vercel.json` gains a rewrite from `/api/ai/status` to the function that
  serves it, so the deployed path matches the dev server's.
- Telemetry: none added, renamed or removed. This is a server route outside the
  `features/` and `widgets/` slices; the client side (HOO-1747) owns the events.

## Capabilities

### New Capabilities

- `assistant-ai-status`: the per-caller report of whether an AI key is
  available and whose it is, which the client gates AI surfaces on.

### Modified Capabilities

None.

## Impact

- Code: `client-v2/api/ai.mjs` and its `node --test` cases, `client-v2/vercel.json`,
  and `client-v2/api-routing.test.mjs`.
- API: one new read-only route. `GET /api/agent` is unchanged and keeps
  serving the current probe until HOO-1747 moves the client over.
- User-visible: nothing until HOO-1747 reads the answer; then AI surfaces
  appear only when they can work, and otherwise point at sign-in or settings.
- Out of scope: the client gate (HOO-1747), the daily spend cap's state
  (a capped user still reads `available`; the turn's own 429 says so), and any
  change to how `/api/agent` takes a turn.
