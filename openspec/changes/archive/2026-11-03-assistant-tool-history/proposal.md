# Proposal

## Why

The model forgets what it did the moment its conversation is reopened. The
provider's in-memory history holds every tool call and result, but a stored
thread holds only a render model, so a provider rebuilt after a reload, on
another device, or after a backend switch or tune is seeded with text alone
(`toReplayMessages`). It then re-runs tools it already ran, or contradicts
results it no longer sees. The 29 Oct security review asked that later turns
can see what the agent did (HOO-2425).

## What Changes

- Every tool call that finishes is stored with the thread: the tool's name,
  its input, its result, and whether it failed, as a record on a `tool` item
  that the thread does not render.
- Long inputs and results are capped before they are stored, with a marker
  saying how much was cut, so a thread stays inside the sync limit and a
  replay inside the default backend's body limit.
- A provider built for a stored thread replays those records as tool-call and
  tool-result pairs in the place they happened. A call with no stored result
  is never replayed.
- A thread written before this change replays as it does today: text only.
- `runTurn` reports each tool's result, as it already reports each call.
- No telemetry event is added, renamed or removed: the assistant's events are
  unchanged.

## Capabilities

### New Capabilities

- `assistant-conversation-history`: what a stored assistant thread keeps of
  each turn, and what a provider built for it sends the model as the
  conversation so far.

### Modified Capabilities

None.

## Impact

- `client-v2/src/shared/lib/ai/run-turn.ts`: reports tool results.
- `client-v2/src/views/sidebar/assistant/store.ts` (the `tool` item gains an
  optional record, and a writer for it) and `model/provider.ts` (records each
  result, seeds its history from the replay).
- `client-v2/src/features/persistence/model/replay.ts` (replays the records)
  and `chat-codec.ts` (decodes them).
- `client-v2/src/widgets/assistant/ui/BaseThreadItem.tsx`: renders nothing for
  a record, so the thread looks as it does today.
- No server, API or database change: the record rides on the `tool` kind,
  which `/api/conversations` and the `messages_kind_check` constraint already
  accept, so nothing waits on a migration.
- User-visible consequence: after a reload, on another device, or after a
  backend switch, the assistant remembers which files it read, which builds
  it ran and what they said.

Out of scope:

- One transcript shared by every backend, without clearing the panel on a
  switch: HOO-1752. This change gives it the stored calls to read.
- Showing a call's input and result in the thread (an expandable marker): a
  visible design question that nobody has asked yet.
- Provider-only parts of a turn (reasoning signatures, Gemini thought
  signatures): never stored, so never replayed.
