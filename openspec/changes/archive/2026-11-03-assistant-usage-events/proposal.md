# Proposal

## Why

The assistant is the one slice whose use costs money and whose events say
nothing about that use. `widgets/assistant` reports picks, stops and
approvals, but not whether a prompt was sent, answered, refused or cut off,
nor on which backend. The customer cannot see AI usage next to page views
(HOO-1799), and the cost gate's caps (HOO-1751) cannot be tuned from data
because nothing records how often a turn is refused under them. This is
HOO-2078.

## What Changes

- `widgets/assistant` tracks each turn: sent, then answered, failed or
  capped. A stopped turn ends with `assistant_turn_stopped`, which it already
  sends, and nothing else, so every sent turn ends with exactly one outcome
  event.
- Events added: `assistant_turn_sent {provider}`,
  `assistant_turn_answered {provider}`,
  `assistant_turn_failed {provider, reason, status}` and
  `assistant_turn_capped {provider}`. None renamed or removed.
- A turn's failure reaches the widget as one typed failure with a reason and
  an HTTP status, in place of today's mix of the SDK's error and plain errors
  with user-facing text, so the failed event can say why without reading the
  message or loading the SDK. The message shown in the thread does not
  change.
- `assistant_turn_capped` fires for the cost gate's two limit refusals
  (HOO-1751: the daily cap's 429 and the exhausted pool's 503), which the
  gate's own `agent_refused` event already describes by kind and tier; the
  turn event only counts the outcome per backend.

## Capabilities

### New Capabilities

- `client-v2-assistant-usage`: what the assistant reports about each turn it
  sends to a model, so usage and refusals can be measured per backend.

### Modified Capabilities

None. The assistant's existing events are a delta of `ui-migration`
(`client-v2-assistant`); this change adds a capability of its own so the two
archive independently.

## Impact

- `client-v2/src/widgets/assistant/model/telemetry.ts`: four events.
- `client-v2/src/widgets/assistant/model/use-turn.ts`: tracks them around
  the provider's send.
- `client-v2/src/views/sidebar/assistant/model/types.ts` and
  `model/provider.ts`: the typed turn failure the provider rejects with.
- Depends on HOO-1751's `backendRefusal` in
  `model-providers/default.ts` and its `features/agent` slice; this change
  edits neither.
- Tests: `provider.test.ts` gains a row per failure reason;
  `use-turn.test.tsx` gains cases that assert the events through the memory
  provider and that no event carries the prompt.
- Users see no change. The events reach GA4 only where
  `REACT_APP_GA_MEASUREMENT_ID` is set, as every event does.
- Out of scope:
  - Deploy-attempt events (HOO-2090, the rest of HOO-1799).
  - The cost gate itself, its refusal shape and its `agent_refused` event
    (HOO-1751), which this change builds on and does not alter.
  - Events for the server rail (`api/agent.mjs`), which cannot import
    `shared/lib/telemetry`.
  - Per-request events inside a turn (steps, resumes, tool calls): a turn is
    the unit the user acts on and the gate counts.
  - Token counts or cost figures: the client never sees them.
