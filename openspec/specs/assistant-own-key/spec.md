# assistant-own-key Specification

## Purpose

Defines how the assistant panel keeps, reuses and forgets the API key a user
supplies for a backend that needs one, and where that key may and may not go.

## Requirements

### Requirement: The key survives a reload of its tab

When the user connects to a backend that needs a key, the panel SHALL keep that
connection (provider, key, base URL, model and effort) in the tab's
`sessionStorage`, and on the next load of the same tab SHALL reconnect to it
without showing the picker or asking for the key.

#### Scenario: Reloading the tab keeps the connection

- **WHEN** the user connects to a key-based backend with a key and reloads the
  tab
- **THEN** the panel is connected to the same backend with the same key, model
  and base URL, and the key field `#assistant-api-key` is not shown

#### Scenario: Changing the backend is not undone

- **WHEN** the user is connected with a key and opens the picker to change
  backend
- **THEN** the panel stays on the picker with the current connection
  unchanged, and does not reconnect by itself

#### Scenario: Storage that refuses access

- **WHEN** `sessionStorage` throws on read or write (a private window, blocked
  site data)
- **THEN** connecting still works for the life of the page, and the next load
  shows the picker instead of failing

### Requirement: The key is kept per tab

The panel SHALL keep the key in the tab's `sessionStorage` only, so a new tab
of the same origin SHALL start with no stored key-based connection. A tab the
browser duplicates or restores carries its `sessionStorage` with it, and
reconnects with the key as after a reload.

#### Scenario: A new tab asks again

- **WHEN** the user has connected to a key-based backend in one tab and opens
  the app in a new tab
- **THEN** the new tab is not connected and shows the picker

### Requirement: Disconnecting forgets the key

Disconnecting (the Forget key button in the chat header), or connecting to a
backend that needs no key, SHALL remove the stored key-based connection, so the
next load does not reconnect to it.

#### Scenario: Forgetting the key, then reload

- **WHEN** the user is connected to a key-based backend, presses Forget key in
  the chat header and reloads the tab
- **THEN** the panel is not connected and `sessionStorage` holds no key

#### Scenario: Switching to the default backend

- **WHEN** the user switches from a key-based backend to the keyless default
- **THEN** `sessionStorage` holds no key

### Requirement: The key goes only to the provider

The key SHALL be sent only to the provider the user picked, as a request header
on each request, and SHALL NOT be written to `localStorage`, IndexedDB, a
persisted or synced conversation, our server, a log line, a telemetry event or
an error report.

#### Scenario: Nothing durable holds the key

- **WHEN** the user connects to a key-based backend and reloads the tab
- **THEN** neither `localStorage` nor IndexedDB contains the key string

#### Scenario: Requests to our origin carry no key

- **WHEN** the user connects to a key-based backend and reloads the tab
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
