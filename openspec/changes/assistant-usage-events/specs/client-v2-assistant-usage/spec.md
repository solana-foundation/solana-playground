# Spec Delta

## Purpose

What the assistant reports about each turn it sends to a model: which
backend took it and how it ended, so AI usage and refusals can be measured
without reading a prompt, a reply or a key.

Every scenario is marked `(manual)`: the events leave the browser only
through GA4, which no Playwright test can read. Each is held by a unit test
through the memory provider, in `provider.test.ts` for the failure reasons
and `use-turn.test.tsx` for the events, and can be checked by hand in GA4's
DebugView on a deployment with a measurement id.

## ADDED Requirements

### Requirement: Every turn is reported once as sent and once as ended

The assistant SHALL send `assistant_turn_sent {provider}` when a prompt is
handed to the backend, and exactly one of `assistant_turn_answered`,
`assistant_turn_failed`, `assistant_turn_capped` or `assistant_turn_stopped`
when that turn ends. `provider` is `default`, `anthropic`, `openai`,
`openrouter` or `gemini`. A send that finds no backend, or is refused
because another turn runs, sends nothing.

#### Scenario: An answered turn (manual)

- **WHEN** a user sends a message and the backend's answer completes
- **THEN** `assistant_turn_sent` and then `assistant_turn_answered` are
  sent, both with the connection's `provider`

#### Scenario: A send with nothing connected (manual)

- **WHEN** a user sends a message with no backend connected and no default
  to connect
- **THEN** no turn event is sent

#### Scenario: A send refused while a turn runs (manual)

- **WHEN** a user sends a second message while a turn is under way
- **THEN** no turn event is sent for the second message

#### Scenario: A stopped turn (manual)

- **WHEN** a user presses Stop while the answer streams
- **THEN** `assistant_turn_sent` and `assistant_turn_stopped` are sent, and
  neither `assistant_turn_answered` nor `assistant_turn_failed` is

### Requirement: A failed turn names its reason

The assistant SHALL send `assistant_turn_failed {provider, reason, status}`
when a turn ends without an answer and was not stopped. `reason` is
`provider` (the backend answered with an error or did not answer),
`refusal` (the model refused the prompt), `paused` (the turn kept pausing
past the resume limit), or `other` (any failure raised on this side, such as
the step limit). `status` is the HTTP status the backend answered with, or
absent when there was none.

#### Scenario: The backend answers with an error status (manual)

- **WHEN** the backend answers a turn with a 500
- **THEN** `assistant_turn_failed` is sent with reason `provider` and status
  `500`

#### Scenario: The model refuses the prompt (manual)

- **WHEN** the model ends the turn with a refusal
- **THEN** `assistant_turn_failed` is sent with reason `refusal` and no
  status

#### Scenario: The turn fails on this side (manual)

- **WHEN** the turn ends because the model was still calling tools at the
  step limit
- **THEN** `assistant_turn_failed` is sent with reason `other` and no status

### Requirement: A turn the cost gate refuses is reported as capped

The assistant SHALL send `assistant_turn_capped {provider}` in place of
`assistant_turn_failed` when the default backend refuses the turn under its
cost gate (HOO-1751): a 429 with reason `daily-cap` or a 503 with reason
`pool-exhausted`. The cap's kind and the user's tier are on the gate's own
`agent_refused` event, not repeated here. An upstream rate limit relayed by
the default backend carries no reason and is not a cap: it is reported as
failed with reason `provider` and status `429`.

#### Scenario: The cost gate refuses a turn (manual)

- **WHEN** the default backend refuses a turn with reason `daily-cap` or
  `pool-exhausted`
- **THEN** `assistant_turn_capped` is sent with provider `default`, and
  `assistant_turn_failed` is not

#### Scenario: The upstream rate-limits a turn (manual)

- **WHEN** the default backend relays an upstream 429 that is not the cost
  gate's refusal
- **THEN** `assistant_turn_failed` is sent with reason `provider` and status
  `429`

### Requirement: No event carries the conversation or a key

No turn event SHALL carry the prompt, any part of a reply, a tool's input or
output, a file's contents, or a backend key, in any parameter.

#### Scenario: The prompt stays out of the events (manual)

- **WHEN** a user sends a message whose text is known to the test and the
  turn ends in an answer, a failure whose message quotes the prompt, or a
  stop
- **THEN** no event sent during the turn has the prompt's text in any
  parameter
