## ADDED Requirements

### Requirement: The Network row is the only network control

Settings SHALL offer the network only in the Network row (its chips and the custom RPC list). No other section SHALL show a control for the RPC endpoint; the Connection section keeps its other rows.

#### Scenario: No endpoint select in Connection

- **WHEN** a person opens Settings and reads the Connection section
- **THEN** it has no "Endpoint" row and no control offering Custom
- **AND** the Network row's chips still pick the network

### Requirement: A custom RPC URL is checked for an answer before it is saved

Saving a custom RPC whose URL is new to the list (an add, or an edit that changes the URL) SHALL, once the URL passes the URL rule and is not a duplicate, send one health request to it and wait at most 5 s. While it waits, the "Save" button SHALL show a spinner, the form's fields SHALL be read-only, and "Cancel" and the list's "Add custom RPC", "Edit {name}" and "Remove {name}" buttons SHALL be disabled. Any HTTP answer within 5 s SHALL save and pick the RPC. With no answer in 5 s, or a request the browser cannot complete, the field SHALL show "This URL is not responding." and a "Use anyway" button, and save nothing; "Use anyway" SHALL save and pick the RPC. Changing the URL SHALL clear that error; changing the name SHALL clear it too, since "Use anyway" saves what was checked, while a refusal by the URL rule or as a duplicate stays until the URL changes. A save that fails unexpectedly SHALL show "Could not save in this browser." and leave the form editable. When the browser reports it is offline, no request SHALL be sent and the field SHALL show "You're offline, so this URL can't be checked." with the same "Use anyway" button. An edit that keeps the URL SHALL save at once, with no request. A value refused by the URL rule or as a duplicate SHALL send no request.

#### Scenario: A URL that answers is saved

- **WHEN** a person adds `https://api.devnet.solana.com` under a name of their own and the URL answers within 5 s
- **THEN** a spinner shows in "Save" while it waits
- **AND** the RPC is saved and its chip is checked, with no prompt

#### Scenario: A URL that does not answer offers Use anyway

- **WHEN** a person adds `https://example.invalid`
- **THEN** within 5 s the field shows "This URL is not responding." and a "Use anyway" button, and nothing is saved
- **AND** pressing "Use anyway" saves the RPC and checks its chip

#### Scenario: Offline, nothing is sent

- **WHEN** the browser is offline and a person saves a valid custom URL
- **THEN** the field shows "You're offline, so this URL can't be checked." and "Use anyway"
- **AND** no request is sent and nothing is saved until "Use anyway" is pressed

#### Scenario: A rename sends no request

- **WHEN** a person edits a saved RPC's name and keeps its URL
- **THEN** it saves at once and no request is sent

## MODIFIED Requirements

### Requirement: Custom RPC telemetry

The `settings-page` widget SHALL send `settings_custom_rpc_saved` when an RPC is saved (`mode`: `add` or `edit`; `check`: `passed` when the URL answered, `used_anyway` when saved through "Use anyway", `none` when no request was needed), `settings_custom_rpc_removed` when one is removed (`picked`: `true` or `false`), and `settings_custom_rpc_refused` when a save is refused (`reason`: `format`, `duplicate`, `storage`, `no_answer` or `offline`). No event SHALL carry a URL, a host or a name.

#### Scenario: Events carry no address (manual)

- **WHEN** a person adds, edits, refuses and removes a custom RPC
- **THEN** each event fires with only the parameters above

#### Scenario: Use anyway is told apart (manual)

- **WHEN** a URL does not answer and the person presses "Use anyway"
- **THEN** `settings_custom_rpc_refused` fires with `reason: no_answer`, then `settings_custom_rpc_saved` with `check: used_anyway`
