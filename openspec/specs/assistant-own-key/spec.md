# assistant-own-key Specification

## Purpose

Defines how the assistant panel keeps, reuses and forgets the API key a user
supplies for a backend that needs one, where that key may and may not go, and
that the keyless default backend needs a signed-in user.

## Requirements

### Requirement: The key goes only to the provider

The key SHALL be sent only to the provider the user picked, as a request header
on each request, and SHALL NOT be written to `localStorage`, IndexedDB, a
persisted or synced conversation, our server, a log line, a telemetry event or
an error report.

#### Scenario: Nothing durable holds the key

- **WHEN** the user connects to a key-based backend and the key is held in
  memory
- **THEN** neither `localStorage` nor IndexedDB contains the key string

#### Scenario: Requests to our origin carry no key

- **WHEN** the user connects to a key-based backend and the key is held in
  memory
- **THEN** no request to the app's own origin carries the key in a header or
  body

#### Scenario: Sending a message sends the key to the provider only

- **WHEN** the user is connected to a key-based backend and sends a message
- **THEN** the provider's request carries the key as `Authorization: Bearer`,
  no request to the app's own origin carries it, and the stored conversation
  does not contain it

### Requirement: The default backend needs a signed-in user

The keyless default backend spends the deployment's own key, so the panel SHALL
connect to it, and reconnect a remembered choice of it, only while a user is
signed in. A signed-out user SHALL see it tagged "sign-in needed", with a
**Sign in with GitHub** button in place of **Start**. When the session ends
while the panel is connected to it, the panel SHALL return to the picker. A
key-based backend SHALL NOT depend on the session.

#### Scenario: Signed out, the default backend offers sign-in

- **WHEN** a signed-out user opens a project on a deployment that serves a
  default backend, with the default backend remembered from an earlier visit
- **THEN** the panel is not connected, the picker tags the default backend
  "sign-in needed" and not "no key needed", reads "Sign in with GitHub to use
  it, or bring your own key below.", and shows no **Start** button

#### Scenario: Signed in, the remembered default backend reconnects

- **WHEN** a signed-in user opens a project on a deployment that serves a
  default backend, with the default backend remembered from an earlier visit
- **THEN** the panel connects to the default backend without showing the
  picker

#### Scenario: Signing out while connected to the default backend

- **WHEN** a signed-in user connected to the default backend signs out from
  the header
- **THEN** the panel shows the picker with the default backend tagged
  "sign-in needed", and the composer `Message the assistant` is hidden

#### Scenario: The session ends mid-chat on the default backend

- **WHEN** the session of a user connected to the default backend ends
  outside this tab (it expires, or another tab signs out) and the user sends a
  message
- **THEN** the chat shows "Sign in with GitHub to use the default backend.",
  then the panel shows the picker with the default backend tagged
  "sign-in needed", and the composer `Message the assistant` is hidden

#### Scenario: Signing out leaves a key-based backend connected (manual)

- **WHEN** a signed-in user connected to a key-based backend signs out
- **THEN** the panel stays in the chat on the same backend with the same key

Checked by the unit test "leaves a key-based backend alone when the session
ends" in `client-v2/src/views/sidebar/assistant/store.test.ts`.

### Requirement: A sign-in from the assistant panel keeps the open project

A sign-in started from the assistant picker SHALL leave the open project open.
A sign-in from the header SHALL still open the account's most recently changed
project.

#### Scenario: Signing in from the panel keeps the open project (manual)

- **WHEN** a signed-out user with a project open presses
  **Sign in with GitHub** in the assistant picker and completes the sign-in
- **THEN** the same project stays open, where a sign-in from the header opens
  the account's most recently changed project

Checked by the unit test "keeps the open project when the sign-in started in
the assistant panel" in `client-v2/src/effects/session/session.test.ts`.

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
with no other parameters. Disconnecting (Delete my key, in Settings or the
chat header's More) SHALL remove it, as today.

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

### Requirement: The key is held in memory only

When the user connects to a backend that needs a key, the panel SHALL hold
the key in the page's memory only and SHALL NOT write it, or any value
containing it, to `sessionStorage`, `localStorage` or IndexedDB. A reload, a
new tab, or a tab the browser duplicates or restores SHALL start with no
key-based connection. The backend's parameters without the key (provider,
model, base URL, effort) stay remembered, so Connect a model, opened with
nothing connected, starts on them with the key field `#assistant-api-key`
empty. A key-based connection
an older build left in `sessionStorage` SHALL be removed on the first load.

#### Scenario: A reload asks for the key again

- **WHEN** the user connects to a key-based backend with a key, reloads the
  tab and presses **Connect a model** in the composer
- **THEN** the panel was not connected after the reload, Connect a model
  opens on the same provider and model with an empty `#assistant-api-key`,
  and no storage holds the key string

#### Scenario: A new tab asks again

- **WHEN** the user has connected to a key-based backend in one tab and opens
  the app in a new tab
- **THEN** the new tab is not connected and shows the picker

#### Scenario: A key an older build kept is removed

- **WHEN** the tab's `sessionStorage` holds a key-based connection under
  `assistant.connection` and the app loads
- **THEN** the panel is not connected and `sessionStorage` no longer holds
  the entry

#### Scenario: Changing the backend is not undone

- **WHEN** the user is connected with a key and opens the picker to change
  backend
- **THEN** the panel stays on the picker with the current connection
  unchanged, and does not reconnect by itself

### Requirement: Delete my key removes the key

Settings SHALL show an **Assistant** section, after Network, with a row
"Your model key" and a button **Delete my key**. The button SHALL be enabled
while a backend holding the user's key is connected, and disabled when no
key is entered or while a turn is using the key. The assistant head's More
menu SHALL offer the same action under the same name while such a backend
is connected. Pressing either SHALL drop the key from memory and from any
storage an older build wrote, disconnect the backend, forget the remembered
choice, and leave the panel unconnected, so the next send goes where a send
with nothing chosen goes: the keyless default when the deployment serves it
to this user, else Connect a model. If the key an older build kept cannot be
removed, Settings SHALL say so in the row, since its notice in the panel is
hidden under Settings. Connecting to a backend
that needs no key SHALL drop the key too.

Pressing it in Settings SHALL fire `settings_key_deleted` with no
parameters; picking it from the head's More SHALL fire
`assistant_key_deleted` with no parameters.

#### Scenario: Delete my key from Settings

- **WHEN** the user is connected to a key-based backend, opens Settings and
  presses **Delete my key**
- **THEN** the button becomes disabled, the row reads that no key is
  entered, the panel is not connected after Back to app, and no storage
  holds the key string

#### Scenario: Delete my key from the chat header

- **WHEN** the user is connected to a key-based backend, picks **Delete my
  key** in the chat header's More and reloads the tab
- **THEN** the panel is not connected and `sessionStorage` holds no key

#### Scenario: No key, nothing to delete

- **WHEN** the panel is connected to the default backend, or to nothing, and
  the user opens Settings
- **THEN** **Delete my key** is shown disabled

#### Scenario: Switching to the default backend

- **WHEN** the user switches from a key-based backend to the keyless default
- **THEN** no storage holds the key
