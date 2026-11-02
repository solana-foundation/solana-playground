# Design

## Context

`api/agent.mjs` already decides whether the deployment serves a default
backend: a key (`agentEnv().API_KEY`) and complete sign-in settings
(`missingConfig()` empty). Its `GET` answers `{ configured, model }` without
looking at the caller. `readSession` (auth's `server.mjs`) never throws and
returns `signed-in`, `signed-out`, `unavailable` or `unconfigured`.

The dev server dispatches `/api/<first-segment>` to `api/<first-segment>.mjs`;
the platform maps each file to exactly one path, and spans segments only
through a `vercel.json` rewrite (`api-routing.test.mjs`).

## Goals / Non-Goals

**Goals:** one answer per caller with no other source needed by HOO-1747; the
key never leaves the server.

**Non-Goals:** the client gate; reporting the daily cap; changing
`GET /api/agent`, which the current probe still reads.

## Decisions

1. **`api/ai.mjs` plus a rewrite, not `api/ai/status.mjs`.** A nested file
   works on the platform but the dev server would look for `api/ai.mjs` and
   answer 404. A rewrite `/api/ai/status` -> `/api/ai` keeps one file serving
   both, the same way `/api/auth` is served. Changing the dev server's
   dispatch was rejected: it is shared by every route and has its own test.
2. **`key: "hosted" | "own"` and a separate `reason`.** The client needs two
   things: whether to mount AI surfaces (`available`), and where to point the
   user when not (`reason: "signed-out"` -> sign in, `key: "own"` -> settings).
   A single enum would merge "whose key" with "why not yet".
3. **The hosted rule is the same as `/api/agent`'s.** Key present and sign-in
   configured; without sign-in the POST refuses every turn, so the key counts
   as absent. The session is read only when that holds, so a deployment with
   no key never opens the pool.
4. **`unavailable` is its own reason.** A failed lookup is not "signed out":
   telling the user to sign in would not help, because signing in needs the
   same lookup.
5. **`model` is named when the key is hosted, signed in or not.** It is the
   same id `GET /api/agent` already publishes; the client can show what a
   sign-in would unlock.

## Risks / Trade-offs

- [Two probes say overlapping things until HOO-1747 lands] -> the hosted rule
  is written in both routes, and a case in `ai.test.mjs` holds them to the
  same answer for every combination of key and sign-in; HOO-1747 moves the
  client to this route, after which `GET /api/agent` can be retired in its
  own ticket.
- [A capped user reads `available: true` and their turn then gets 429] ->
  deliberate: the cap resets daily and the turn's refusal already explains it.
