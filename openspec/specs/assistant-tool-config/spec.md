# assistant-tool-config Specification

## Purpose
What of the user's skill and MCP server configuration survives a reload, how it layers over the deployment's defaults,
and what never reaches storage.

## Requirements

### Requirement: The user's edits survive a reload

The client SHALL keep, in `/.config/assistant-tools.json` through `PgFs`, the skills whose choice differs from their
default, the ids of gateway servers turned off, and the user's own server list, and SHALL apply them on load before it
discovers any server's tools. A file that does not parse SHALL be reported and read as no edits, and left in place until
the next edit replaces it. When storage fails the read itself, the failure SHALL be reported and the file SHALL NOT be
written until a later read succeeds, since it may hold edits this page never saw.

#### Scenario: A reload after turning a skill off and adding a server

- **WHEN** the user turns a skill off, adds an MCP server, and reloads the page
- **THEN** the skill's checkbox `#skill-<id>` is unchecked and the server is listed

#### Scenario: A reload after turning a gateway server off (manual)

- **WHEN** the user turns a gateway server off and reloads the page
- **THEN** its checkbox is unchecked and no request for its tools is sent

### Requirement: The stored file is a delta over the defaults

A skill the file does not name SHALL follow its entry's `enabled`. A choice equal to the default SHALL NOT be stored.
An id neither listed nor a valid entry SHALL have no effect, and SHALL leave the file on the next write made while
signed in, since the gateway lists `signedIn` sources only to a signed-in caller. A write made while signed out SHALL
keep it.

#### Scenario: A skill added after the file was written (manual)

- **WHEN** the deployment lists a skill the file does not name
- **THEN** the skill is on or off as its entry's `enabled` says

#### Scenario: An id the deployment no longer lists (manual)

- **WHEN** the file names a skill the deployment does not list and a signed-in user changes any choice
- **THEN** the unknown skill has no effect and is not in the file after the write

#### Scenario: A signed-out edit keeps a signed-in skill's choice (manual)

- **WHEN** a signed-in user turned a `signedIn` skill off, signs out, changes another choice, and signs in again
- **THEN** the `signedIn` skill is still off

### Requirement: No credential reaches storage

The file SHALL NOT hold a user server's `authToken`, `headers`, `queryParams`, `protection` or the query of its `url`.
They SHALL stay in memory for the session. A restored entry SHALL record which of them it lost in a `missing` list
naming fields only, and the editor SHALL show those names in a `role="status"` line until that entry is next applied with a change,
with or without those fields; an entry applied unchanged beside another keeps its line.

#### Scenario: The stored file after adding a server with a token

- **WHEN** the user adds a server with `authToken` and `headers`, and the test reads the stored file before and after a
  reload
- **THEN** neither read contains the token or the header's value, and after the reload the editor names `authToken` and
  `headers` as fields to enter again

#### Scenario: Entering a token again (manual)

- **WHEN** the user applies the restored entry with its `authToken` filled in
- **THEN** requests to the server carry the token, the line naming it is gone, and the file still holds no token

#### Scenario: Applying the entry without the token (manual)

- **WHEN** the user changes the restored entry, leaves `authToken` out, and applies it
- **THEN** the line naming it is gone, and it does not come back after a reload
