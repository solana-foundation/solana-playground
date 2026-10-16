## MODIFIED Requirements

### Requirement: The key survives a reload of its tab

When the user connects to a backend that needs a key, the panel SHALL keep that
connection (provider, key, base URL, model and effort) in the tab's
`sessionStorage`, and on the next load of the same tab SHALL reconnect to it
without opening Connect a model or asking for the key.

#### Scenario: Reloading the tab keeps the connection

- **WHEN** the user connects to a key-based backend with a key and reloads the
  tab
- **THEN** the panel is connected to the same backend with the same key, model
  and base URL, ahead of a remembered default the deployment also serves, and
  the key field `#assistant-api-key` is not shown

#### Scenario: Changing the backend is not undone

- **WHEN** a key is kept for the tab, nothing is connected, Connect a model is
  open, and the assistant panel is folded and opened again
- **THEN** nothing reconnects by itself: the panel stays unconnected and
  Connect a model stays open

#### Scenario: Storage that refuses access

- **WHEN** `sessionStorage` throws on read or write (a private window, blocked
  site data)
- **THEN** connecting still works for the life of the page, and the next load
  starts unconnected, the composer's model button reading "Connect a model",
  instead of failing

### Requirement: The key is kept per tab

The panel SHALL keep the key in the tab's `sessionStorage` only, so a new tab
of the same origin SHALL start with no stored key-based connection. A tab the
browser duplicates or restores carries its `sessionStorage` with it, and
reconnects with the key as after a reload.

#### Scenario: A new tab asks again

- **WHEN** the user has connected to a key-based backend in one tab and opens
  the app in a new tab
- **THEN** the new tab is not connected, and its composer's model button reads
  "Connect a model"

### Requirement: Disconnecting forgets the key

Disconnecting (Forget key in the assistant head's More menu, offered only while
a backend that needs a key is connected and disabled during a turn), or
connecting to a backend that needs no key, SHALL remove the stored key-based
connection, so the next load does not reconnect to it.

#### Scenario: Forgetting the key, then reload

- **WHEN** the user is connected to a key-based backend, picks Forget key in
  the assistant head's More menu and reloads the tab
- **THEN** the panel is not connected and `sessionStorage` holds no key

#### Scenario: Switching to the default backend

- **WHEN** the user switches from a key-based backend to the keyless default
- **THEN** `sessionStorage` holds no key
