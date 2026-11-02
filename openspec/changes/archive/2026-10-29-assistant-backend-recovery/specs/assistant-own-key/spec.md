## ADDED Requirements

### Requirement: A thread keeps its backend when the key is gone

When the user sends a message with nothing connected, the panel SHALL take the
backend that produced the open thread's last reply. If that backend needs a
key, the panel SHALL NOT connect the keyless default in its place: it SHALL
open Connect a model preset to that backend's provider, model, base URL and
effort, with the key field `#assistant-api-key` empty, and SHALL keep the typed
prompt in the composer `Message the assistant`. If the last reply came from the
default backend, the send SHALL connect the default as before. A thread with no
reply that names its backend SHALL take the backend this browser last chose
(see "The remembered choice carries no key").

#### Scenario: A new tab does not continue a keyed thread on the default

- **WHEN** a signed-in user on a deployment that serves a default backend has
  a thread last answered by a key-based backend, opens the project in a new
  tab and sends a message
- **THEN** no request goes to the default backend, Connect a model opens with
  that provider and model selected and an empty key field, and the message
  stays in the composer

#### Scenario: Entering the key continues the same thread

- **WHEN** the user in the scenario above enters the key and connects
- **THEN** the thread's earlier messages are still shown, and sending the
  waiting message adds it below them

#### Scenario: A thread answered by the default reconnects the default

- **WHEN** a signed-in user has a thread last answered by the default backend,
  opens the project in a new tab and sends a message
- **THEN** the panel connects the default backend and sends the message
  without opening Connect a model

#### Scenario: A new thread takes the last chosen backend

- **WHEN** the user last chose a key-based backend in this browser, opens a
  project with no conversation in a new tab and sends a message
- **THEN** Connect a model opens preset to that backend with an empty key
  field, and nothing is sent to the default backend

### Requirement: The remembered choice carries no key

The backend the user last chose SHALL be remembered in `localStorage` as its
provider, model, base URL and effort, and never with the key. A remembered
choice written as a bare provider id SHALL still be read, as that provider
with no other parameters. Disconnecting (Forget key) SHALL remove it, as
today.

#### Scenario: The remembered choice holds no key

- **WHEN** the user connects to a key-based backend with a model and a base URL
- **THEN** `localStorage` holds that provider, model and base URL, and does not
  contain the key string

### Requirement: Changing the backend keeps the conversation

Connecting to a backend while another is connected SHALL keep the open thread
on screen and in storage; the next turn SHALL be sent to the new backend with
the conversation so far. Connect a model SHALL NOT say that switching starts a
new conversation.

#### Scenario: Switching backends keeps the thread

- **WHEN** the user has a conversation with one backend and connects to a
  different one in Connect a model
- **THEN** the conversation's messages are still shown, and the next message
  is sent to the new backend

#### Scenario: No warning about a new conversation

- **WHEN** the user connected to one backend opens Connect a model and picks a
  different one
- **THEN** the dialog does not show "Switching starts a new conversation."

### Requirement: A rejected key can be entered again

When the provider answers a turn on a key-based backend with 401, the turn
SHALL end in an error that names the backend and says its key was not
accepted, without the status code, with an **Enter key** button
(`#assistant-enter-key`). The button SHALL open Connect a model preset to that
backend with an empty key field, and SHALL be offered only while nothing but
notices follows that error. Other failures, a 403 included (a valid key
without access to the model), keep their current error.

#### Scenario: A 401 offers Enter key

- **WHEN** the user is connected to a key-based backend and a turn's request
  is answered with 401
- **THEN** the chat shows an error naming the backend with an **Enter key**
  button, and pressing it opens Connect a model with that provider selected and
  the key field empty

#### Scenario: A 403 or a 500 keeps the ordinary error (manual)

- **WHEN** a turn's request is answered with 403 or 500
- **THEN** the chat shows the provider's error without an **Enter key**
  button

Checked by a unit test in `client-v2/src/widgets/assistant/model/use-turn.test.tsx`.

### Requirement: Recovering a backend is measured

The assistant widget SHALL report, through its tracker:

- `assistant_connect_opened` with `via` `"thread"` when a send with nothing
  connected opens Connect a model preset to the thread's own backend, and
  `"key-rejected"` when the **Enter key** button opens it; its other values
  (`"menu"`, `"model"`, `"send"`, `"setup"`) are unchanged.
- `assistant_key_rejected` when a turn on a key-based backend ends on 401,
  with `provider` the backend's provider id. It carries nothing else: no key,
  no model, no base URL.

#### Scenario: A rejected key is counted (manual)

- **WHEN** a turn's request on a key-based backend is answered with 401
- **THEN** `assistant_key_rejected` is reported once with the provider

Checked by a unit test through the memory provider in
`client-v2/src/widgets/assistant/model/use-turn.test.tsx`.
