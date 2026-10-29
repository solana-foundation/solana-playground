# Spec Delta

## Purpose

How the assistant's composer names the model it talks to, how a turn is
sent and stopped, how a model is connected, and how the thread reads and
answers approvals at every width.

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
message with no key and no connect step first. With no default backend and
nothing connected, Send SHALL be disabled until a model is connected.

#### Scenario: The first message on the hosted default

- **WHEN** nothing is connected and a user types a message and sends it
- **THEN** the message goes to the default backend and its answer appears

#### Scenario: No default backend

- **WHEN** the deployment serves no default backend, nothing is connected,
  and a user types a message
- **THEN** Send is disabled and its tooltip says to connect a model, Enter
  sends nothing, and the model button "Connect a model" opens Connect a model
  with the message still in the composer

### Requirement: Send turns to Stop

While an answer is coming, the composer's Send SHALL be a Stop that ends the
turn.

#### Scenario: Stopping an answer

- **WHEN** a user sends a message and presses Stop while the answer streams
- **THEN** the turn ends, the thread says it was stopped, and Send is back

### Requirement: A busy model is asked again

When the model answers that it is busy (a 429) before the turn has run any
tool, the thread SHALL show "The model is busy" with a countdown, and SHALL
send the message again when it ends, at most three times, then say to send
it again in a minute. The wait SHALL be the server's when it names one, and
Try now SHALL be off until it ends; a wait longer than a minute SHALL not be
counted down. Try now SHALL send at once and Stop SHALL drop the retry. A
busy answer after a tool ran SHALL NOT be sent again, since the tool's work
would run twice.

#### Scenario: A busy model counts down and sends again (manual)

- **WHEN** a user sends a message and the model answers 429 with no wait
- **THEN** the thread shows "The model is busy" and "Trying again in 10 s",
  and the message is sent again when it reaches 0

#### Scenario: Try now and Stop (manual)

- **WHEN** the busy countdown shows and the user presses Try now, or
  presses Stop
- **THEN** Try now sends the message at once; Stop removes the countdown and
  sends nothing

#### Scenario: Busy after a tool ran (manual)

- **WHEN** the model calls a tool and its next request answers 429
- **THEN** the thread says the model is busy and that what it ran stays
  done, and nothing is sent again

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
  (More), `model` (the model button or a model of another backend), `send`
  (a Send with nothing to send to) or `setup` (the Get set up checklist's
  "Connect the assistant").
- `assistant_turn_stopped`: a user stopped a turn; once per turn.
- `assistant_default_probe_failed {reason}`: asking the deployment for its
  default backend failed; `reason` is `network`, `status` (an answer that is
  neither a success nor a 404) or `body` (an answer with no boolean
  `configured`). A 404 means the deployment serves no `/api/agent`, which is
  expected off a full deployment: it is logged as a warning, not reported,
  and sends no event.
- `assistant_approval_answered {kind, answer}`: a user answered an approval
  card; `kind` is `patch` or `command`, `answer` is `allow` or `deny`. Once
  per card.
- `assistant_suggestion_picked`: a user picked one of the empty thread's
  suggestions, which sends it, or opens Connect a model when nothing is
  connected.
- `assistant_make_change_requested`: a user asked for a described change as
  a patch ("Make this change" or "Write it for me").

#### Scenario: Stopping a turn is reported once

- **WHEN** a user sends a message and presses Stop twice while the answer
  streams
- **THEN** `assistant_turn_stopped` is sent once

#### Scenario: Answering an approval is reported once

- **WHEN** a user presses Apply on a patch card and presses it again
- **THEN** `assistant_approval_answered` is sent once, with `kind` `patch`
  and `answer` `allow`

### Requirement: The thread reads at every width

The thread SHALL fit the panel it is in, from a 390 px phone up, and an
approval card SHALL keep its question and its answer in reach.

#### Scenario: A reply with code on a phone

- **WHEN** an answer holding a long line of code arrives at 390 px wide
- **THEN** the page does not scroll sideways; the code scrolls inside its
  block

#### Scenario: A patch card on a phone

- **WHEN** a patch longer than the screen is proposed at 390 px wide
- **THEN** Apply and Reject are on screen with the card's file name, and the
  diff scrolls inside the card

### Requirement: The thread does not pull a reader down

While an answer streams, the thread SHALL follow it only while the reader is
at its end, and SHALL offer a way back to the end otherwise.

#### Scenario: Reading back during an answer

- **WHEN** a user scrolls up while an answer streams
- **THEN** the thread stays where the user scrolled, and "Scroll to end"
  takes them back to the answer

### Requirement: A restored approval stays unanswered

A card that was pending when the session ended SHALL come back answered by
no one, and SHALL offer no way to apply it.

#### Scenario: Reloading with a card pending

- **WHEN** a user reloads while a patch card waits for an answer
- **THEN** the card reads "Not answered" and says the session ended before
  the user answered, with no Apply or Reject

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
