## ADDED Requirements

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

## REMOVED Requirements

### Requirement: The key survives a reload of its tab

**Reason**: The 29 Oct security review (HOO-2423): a key kept in
`sessionStorage` outlives the user's intent and is readable by any script on
the origin.

**Migration**: Replaced by "The key is held in memory only". A reload now
opens Connect a model preset to the remembered backend; the user enters the
key again. A key an older build kept is removed on the first load.

### Requirement: The key is kept per tab

**Reason**: With the key in memory only there is no per-tab copy; a
duplicated or restored tab no longer carries it.

**Migration**: "A new tab asks again" moves to "The key is held in memory
only".

### Requirement: Disconnecting forgets the key

**Reason**: Renamed and extended: the action is now **Delete my key**, in
Settings as well as the chat header.

**Migration**: Replaced by "Delete my key removes the key"; its scenarios
carry the old ones under the new name.
