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

### Requirement: The default backend needs a signed-in user

The keyless default backend spends the deployment's own key, so the panel SHALL
connect to it, and reconnect a remembered choice of it, only while a user is
signed in. A signed-out user SHALL see it in Connect a model tagged "sign-in
needed", with a **Sign in with GitHub** action in place of **Start**. While the
panel is connected to it and nobody is signed in, a send SHALL open Connect a
model with the prompt kept instead of sending; nothing SHALL open on its own
when the session ends. A key-based backend SHALL NOT depend on the session.

#### Scenario: Signed out, the default backend offers sign-in

- **WHEN** a signed-out user opens a project on a deployment that serves a
  default backend, with the default backend remembered from an earlier visit,
  and sends a message
- **THEN** the panel is not connected, Connect a model opens with the prompt
  kept in the composer, tags the default backend "sign-in needed" and not
  "no key needed", reads "Sign in with GitHub to use it, or bring your own key
  below.", and shows no **Start** button

#### Scenario: Signed in, the remembered default backend reconnects

- **WHEN** a signed-in user opens a project on a deployment that serves a
  default backend, with the default backend remembered from an earlier visit
- **THEN** the panel connects to the default backend without opening Connect
  a model

#### Scenario: Signing out while connected to the default backend

- **WHEN** a signed-in user connected to the default backend signs out from
  the account menu, then sends a message
- **THEN** nothing opens on the sign-out; the send opens Connect a model with
  the default backend tagged "sign-in needed"

#### Scenario: The session ends mid-chat on the default backend

- **WHEN** the session of a user connected to the default backend ends
  outside this tab (it expires, or another tab signs out) and the user sends a
  message
- **THEN** the thread shows "Sign in with GitHub to use the default backend.",
  and the next send opens Connect a model with the default backend tagged
  "sign-in needed"

#### Scenario: Signing out leaves a key-based backend connected (manual)

- **WHEN** a signed-in user connected to a key-based backend signs out
- **THEN** the panel stays on the same backend with the same key

Checked by the unit test "never needs sign-in for a key-based backend" in
`client-v2/src/views/sidebar/assistant/store.ts`'s in-source block.
