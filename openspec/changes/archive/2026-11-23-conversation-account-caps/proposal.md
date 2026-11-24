# Proposal

## Why

Finding D3 of the security register (HOO-2882, epic HOO-2872). `POST
/api/conversations` caps one request (2 MB, 500 items, a 200-character title)
but not what an account stores. A signed-in account could post threads and
messages until the shared database filled. And every push for a project id
the server had never seen inserted a `projects` row for it, so a client could
mint any number of project rows outside the project cap (HOO-2538), which
counts only rows that hold files.

## What Changes

- An account stores at most 200 live conversations, 20,000 messages and 32 MiB
  of message payload. A push that would take the account past one of them is
  refused with status 413 and a named `reason`: `too-many-threads`,
  `too-many-messages` or `conversations-too-large`, with `limit` and `count`.
  The refused push writes nothing; everything stored before it stays.
- A push that does not grow a measure is never refused for it, also when the
  account is already over: a re-push of known messages, and an empty first
  push of a thread under the thread cap, still pass.
- A push for a project id the account has no row for is refused with status
  409 and `reason: "no-project"`. No project row is created by a conversation
  push any more; a project row comes only from `PUT /api/projects`, under the
  project cap.
- The client keeps a thread refused for `no-project` owed and pushes it again
  as soon as the server accepts its project, so a project created while
  signed out still has its conversation uploaded on sign-in.
- The assistant panel shows the cap refusal: which cap, its figure, that new
  messages stay in this browser, and how to make room (delete a synced project
  you no longer need, which deletes its conversations).
- No telemetry event is added, renamed or removed. The refusals go to the
  persistence diagnostics, as every other sync failure does; the panel's cap
  line and the `no-project` wait emit nothing.

The figures sit in line with the project caps: an account syncs at most
10 projects and 32 tutorials of at most 512 KiB each, about 21 MiB of code.
32 MiB of conversation is the same order. They live in one module,
`model/chat-limits.mjs`, read by the route and the panel.

## Capabilities

### New Capabilities

- `conversation-sync-limits`: what one account may store in conversations,
  and what a push for an unknown project gets.

## Impact

- `client-v2/api/conversations.mjs`, `model/conversations.mjs`: the caps, the
  `no-project` refusal, and their answers.
- `client-v2/db/migrations`: a stored `bytes` column on `messages` and an index
  that lets the route sum it per account without reading payloads.
- `model/chat-sync.ts`, `effects/chat-thread`: the two new push outcomes and
  the re-push after a project push.
- The assistant panel: one notice line while the cap holds.
