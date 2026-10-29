# Design

## Context

See [proposal.md](proposal.md), "Why". One turn is one call of
`instance.send` in `widgets/assistant/model/use-turn.ts` (`start`): the hook
adds the user message, begins the turn on the store, awaits the provider,
and in `catch` adds an error item unless the turn was aborted. The widget's
tracker, `assistantTelemetry` in `model/telemetry.ts`, already sends
`assistant_turn_stopped` from `stop`.

The provider (`views/sidebar/assistant/model/provider.ts`) runs the turn on
`runTurn` from `shared/lib/ai`, which rejects with `AiTurnError` carrying
`kind` (`provider`, `refusal`, `paused`), `status` and the redacted `body`.
The provider rethrows a refusal and the default backend's signed-out refusal
as plain `Error`s with user-facing text, passes every other `AiTurnError`
through as it is, and raises plain `Error`s of its own for the step limit;
so the hook gets typed data for some failures and text for others.
`shared/lib/ai` is loaded on demand (`loadAi()`), so the widget cannot test
`instanceof AiTurnError` without pulling the SDK into the boot chunk.

The cost gate (HOO-1751, change `default-backend-cost-gate`, PR 71) refuses
a turn with a JSON body carrying `reason` and the user's `tier`: a 429 with
`daily-cap`, or a 503 with `pool-exhausted`. On the client it turns the
profile's `signedOutRefusal` into `backendRefusal`, which answers
`{ kind: "signed-out", message }` or
`{ kind: "limit", reason, tier, message }` with the panel's own sentence, and
the provider tracks `agent_refused {reason, tier}` from `features/agent` for
every limit refusal. An upstream 429 is still relayed with its own status and
no `reason`. This change is stacked on that PR.

## Goals / Non-Goals

**Goals:**

- The four events of
  [specs/client-v2-assistant-usage/spec.md](specs/client-v2-assistant-usage/spec.md),
  each sent from one place.
- The failed event's reason and status come from typed data, not from
  parsing a message.
- No change to what the thread shows for any failure.

**Non-Goals:**

- Changing how the gate's refusal is recognised: `backendRefusal` is
  HOO-1751's and stays as it is.
- Events from inside a turn (steps, resumes, tool calls) or from the server
  rail.
- A Playwright test: the events leave the browser only through GA4, which no
  e2e spec can read. The scenarios are marked `(manual)`, as the coverage
  convention requires when no browser test holds them, and each is held by a
  unit test through the memory provider; the spec's Purpose says which.

## Decisions

### The provider rejects with a typed turn failure

`views/sidebar/assistant/model/types.ts` declares `TurnFailure extends Error`
with `reason: "provider" | "refusal" | "paused" | "capped"`,
`status?: number` and the SDK's error as `cause`, so a log keeps its stack
and redacted body, and the provider rejects with it wherever it rethrows an
`AiTurnError` today: a pass-through keeps the SDK error's `kind` as the
reason and its `status`; a refusal and the signed-out refusal keep the
user-facing text as the message. The hook classifies with
`instanceof TurnFailure`, and any other error is reason `other` with no
status.

Alternatives considered:

- Rethrow the `AiTurnError` itself. The hook would need the class from
  `shared/lib/ai`, a static import that defeats the lazy load measured in
  `assistant-ai-sdk-transport` 5.1.
- Attach the `AiTurnError` as `cause`. Reachable without the class, but the
  hook would read `cause.kind` through a duck-typed check on `unknown`, and
  the provider's own failures (the step limit, the empty response) would
  still need a shape of their own.
- Classify inside the provider and have it track the events. The provider is
  legacy-root code (`views/`) with no tracker, and the sent event belongs to
  the same place as the outcome events, which is the hook.

### The hook sends the events around `instance.send`

`assistant_turn_sent` goes out after `PgAssistant.beginTurn` succeeds, so a
store that throws on the new message sends nothing; the outcome goes out in
the `try`/`catch` next to the error item, with the aborted branch sending
nothing because `stop` has already sent `assistant_turn_stopped`. A turn the
store cuts off without a Stop (its thread closed, the backend changed) is
aborted the same way and ends with no outcome event; it is rare and not the
user's action, so it is accepted rather than given a fifth event.

### `capped` is HOO-1751's limit refusal, both kinds

The provider maps a `backendRefusal` of kind `signed-out` to the session
refresh and a `provider` failure with the 401, and one of kind `limit`, the
daily cap's 429 and the exhausted pool's 503 alike, to a `capped` failure
with that status, after tracking `agent_refused` as HOO-1751 does. An
upstream 429 carries no `reason`, so `backendRefusal` answers nothing for it
and it stays reason `provider`. `assistant_turn_capped` takes only
`provider`: the cap's kind and the tier are already on `agent_refused`, sent
by the same catch block for the same turn, and a GA4 report reads each event
on its own, so the turn event counts outcomes per backend while the agent
event says why.

Alternatives considered: folding the cap into `assistant_turn_failed` as a
reason, which would make the per-backend outcome count depend on reading a
parameter; and copying `reason` and `tier` onto the turn event, a duplicate
of `agent_refused` that the two slices would have to keep in step.

### Scenarios map to unit tests

`use-turn.test.tsx` already mocks the provider and collects events in a
memory provider; the sent, answered, stopped, failed and capped cases are
rows there, with the no-backend case asserting an empty list. The reason
mapping is a row per `AiTurnError` kind in `provider.test.ts`. The
"prompt stays out" scenario serialises every event sent during a turn whose
failure message quotes the prompt and asserts the prompt is absent.

## Risks / Trade-offs

- [A new error class in `views/`, a legacy root] → It is a type for the
  slice's own provider, next to `Provider`, not UI; it moves with the
  provider when that code moves by the UI move rule.
- [Stacked on PR 71] → Task 1.1's PR carries HOO-1751's commits until that
  PR merges, then rebases onto master; the `capped` rows in
  `provider.test.ts` go through the real `backendRefusal`, so nothing stands
  in for the gate.
- [`provider` is sent on every event although the store knows it] → It is
  what the report is grouped by, and a GA4 report cannot join events.
