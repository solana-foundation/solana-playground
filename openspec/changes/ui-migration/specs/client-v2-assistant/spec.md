# Spec Delta

## Purpose

How the assistant's composer names the model it talks to, how a turn is
sent and stopped, and how a model is connected.

## ADDED Requirements

### Requirement: The composer names the model it talks to

The composer SHALL name the model the next message goes to, from what the
deployment or the connection reports, and SHALL offer an effort control only
for a backend that takes one.

#### Scenario: The hosted default

- **WHEN** the deployment serves a default backend and nothing is connected
- **THEN** the composer names the default backend's model and shows no
  effort control

#### Scenario: A backend with an effort ladder

- **WHEN** a user connects a backend whose models take an effort setting
- **THEN** the composer names the picked model and shows its effort

### Requirement: The composer works without a key

On a deployment that serves a default backend, the composer SHALL send a
message with no key and no connect step first.

#### Scenario: The first message on the hosted default

- **WHEN** nothing is connected and a user types a message and sends it
- **THEN** the message goes to the default backend and its answer appears

#### Scenario: No default backend

- **WHEN** the deployment serves no default backend and a user sends a
  message
- **THEN** Connect a model opens and the message stays in the composer

### Requirement: Send turns to Stop

While an answer is coming, the composer's Send SHALL be a Stop that ends the
turn.

#### Scenario: Stopping an answer

- **WHEN** a user sends a message and presses Stop while the answer streams
- **THEN** the turn ends, the thread says it was stopped, and Send is back

### Requirement: The assistant reports what the user does with the model

The assistant SHALL send these telemetry events (prefix `assistant`). None
carries a key, a prompt or a reply.

- `assistant_model_picked {provider, via}`: a pick changed the backend, the
  model or the effort. `provider` is `default`, `anthropic`, `openai`,
  `openrouter` or `gemini`; `via` is `menu` (the composer's model menu) or
  `dialog` (a connection made in Connect a model that differs from the one
  current when it opened). Re-picking the current connection sends nothing.
- `assistant_effort_changed {effort}`: a user picked another effort;
  `effort` is `low`, `medium`, `high`, `xhigh` or `max`.
- `assistant_connect_opened {via}`: Connect a model opened; `via` is `menu`
  (More), `model` (the model button or a model of another backend) or `send`
  (a Send with nothing to send to).
- `assistant_turn_stopped`: a user stopped a turn; once per turn.
- `assistant_default_probe_failed {reason}`: asking the deployment for its
  default backend failed; `reason` is `network`, `status` (an answer that is
  neither a success nor a 404) or `body` (an answer with no boolean
  `configured`). A 404 means the deployment serves no `/api/agent`, which is
  expected off a full deployment: it is logged as a warning, not reported,
  and sends no event.

#### Scenario: Stopping a turn is reported once

- **WHEN** a user sends a message and presses Stop twice while the answer
  streams
- **THEN** `assistant_turn_stopped` is sent once

### Requirement: Connect a model fits the screen

Connect a model SHALL be a dialog on a desktop and a page of its own on a
phone.

#### Scenario: Connecting on a desktop

- **WHEN** a user opens Connect a model at 1280 px wide
- **THEN** a dialog opens over the app and closes once a backend is
  connected

#### Scenario: Connecting on a phone

- **WHEN** a user opens Connect a model at 390 px wide
- **THEN** it fills the screen, with its connect button in reach at the
  bottom
