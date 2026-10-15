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
