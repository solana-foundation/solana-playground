# Spec Delta

## Purpose

The catalogue of sources, skills and MCP servers, that a deployment of client-v2 offers the assistant: how the
server composes it from its environment and for whom, what the gateway and the skills route list, and how the
Sources tab's selection decides what a turn may use.

## ADDED Requirements

### Requirement: One catalogue holds both kinds of source

The catalogue SHALL be one list of entries, each with a `kind` of `mcp` or `skill`, an `id` unique across the
list, a `name`, and the fields of its kind. The server SHALL reject a catalogue, shipped or overriding, with a
duplicate id or an unknown kind, and every request to the gateway or the skills route SHALL then fail with an
error naming the entry rather than serve a partial list.

#### Scenario: Two entries share an id (manual)

- **WHEN** the catalogue in effect holds a skill and a server both with the id `solana`
- **THEN** `GET /api/mcp` and `GET /api/skills` answer 500 with a message naming `solana`, and no source is
  listed

### Requirement: A placeholder is filled from the environment

Any string in an entry MAY hold `${NAME}` or `${NAME:-default}`. The server SHALL fill `${NAME}` with the
variable's value and `${NAME:-default}` with the value or, when the variable is unset or empty, the default. An
entry with a placeholder that has neither a value nor a default SHALL be absent from every listing, wherever in
the entry the placeholder sits.

#### Scenario: A required variable is unset (manual)

- **WHEN** `SOURCES` holds an entry whose `url` is `https://${DOCS_HOST}/mcp` and `DOCS_HOST` is unset
- **THEN** `GET /api/mcp` does not list the entry, and `tools/list` naming it fails as for an unknown server

#### Scenario: The Explorer URL takes its default (manual)

- **WHEN** `MCP_EXPLORER_URL` is unset
- **THEN** the gateway calls Explorer at `https://explorer.solana.com/mcp`

### Requirement: An optional credential resolved empty is not sent

A header or query value, or a bypass secret, written `${NAME:-}` whose variable is unset or empty SHALL be left
out of the entry, so no request carries an empty header, an empty query parameter, or an empty bypass.

#### Scenario: Explorer with nothing set (manual)

- **WHEN** neither `MCP_EXPLORER_BYPASS` nor `MCP_EXPLORER_TOKEN` is set and a signed-out user calls
  `GET /api/mcp`
- **THEN** the answer lists `explorer`, and the gateway's requests to Explorer carry no bypass header and no
  `authorization` header

### Requirement: The override replaces the catalogue

When the server's `SOURCES` variable is set, the server SHALL read it as a JSON array in the catalogue's format
and serve that list in place of the shipped catalogue, with the same placeholder and sign-in rules. A `SOURCES`
that is not a JSON array SHALL make every request to the gateway and the skills route fail with an error naming
`SOURCES`.

#### Scenario: Two servers through the override (manual)

- **WHEN** `SOURCES` holds two `mcp` entries `a` and `b` and no skill
- **THEN** `GET /api/mcp` lists `a` and `b` and not `solana`, `tools/list` with no `server[]` answers both
  servers' tools prefixed `a__` and `b__`, and `GET /api/skills` lists no skill

#### Scenario: The override is not JSON (manual)

- **WHEN** `SOURCES` holds text that does not parse as JSON
- **THEN** `GET /api/mcp` answers 500 with a message naming `SOURCES`

### Requirement: A signed-in entry is withheld from a signed-out caller

An entry marked `signedIn` SHALL be listed and served only to a caller whose request carries a valid session
from this site's origin. For any other caller the entry SHALL be absent from the listing, and a request naming
it SHALL fail as for an unknown server. The shipped catalogue marks no entry `signedIn`.

#### Scenario: A signed-in entry and a signed-out caller (manual)

- **WHEN** `SOURCES` holds an `mcp` entry `team` marked `signedIn` and a signed-out user calls `GET /api/mcp`
- **THEN** the answer lists no `team`, and `tools/list` with `server[]=team` fails with an error naming `team`

### Requirement: A bot-protection bypass rides only on a signed-in caller's requests

An `mcp` entry MAY carry `protection: { provider, secret }`, a bypass for the upstream's bot protection. The
provider SHALL be one the client knows; it decides how the secret travels, as a header when the gateway calls
and as a query parameter when the browser calls. The gateway SHALL list a protected entry for every caller, and
SHALL send its secret only on requests from a caller signed in from this site's origin. Any other caller SHALL
reach the same upstream without the secret. The secret SHALL NOT be sent to the browser.

#### Scenario: A signed-in caller on this site (manual)

- **WHEN** `MCP_EXPLORER_BYPASS` is set and a user signed in on this site lists Explorer's tools
- **THEN** the gateway's request to Explorer carries the bypass header

#### Scenario: A caller who is not signed in on this site (manual)

- **WHEN** `MCP_EXPLORER_BYPASS` is set and a signed-out user, a user whose session lookup failed, or a
  signed-in user calling from another origin lists Explorer's tools
- **THEN** `GET /api/mcp` lists `explorer` for them, and the gateway's request to Explorer carries no bypass
  header

### Requirement: The skills route lists the caller's skills

`GET /api/skills` SHALL answer `{ skills: [...] }` with, for each skill the catalogue offers this caller, its
`id`, `name`, `description`, `enabled`, and `source`: `{ type: "bundled" }` for a skill shipped in the bundle,
or `{ type: "remote", baseUrl, entry }` for one fetched at runtime. The route SHALL answer a request from another
origin as the gateway does, and SHALL answer any method other than GET with 405.

#### Scenario: The shipped catalogue signed out (manual)

- **WHEN** no `SOURCES` is set and a signed-out user calls `GET /api/skills`
- **THEN** the answer lists `playground-env` as bundled, `solana-dev` as remote with its `baseUrl` and `entry`,
  and every community skill as remote with its `enabled` value

#### Scenario: A remote skill's base URL from the environment (manual)

- **WHEN** `SOURCES` holds a remote skill whose `baseUrl` is `${SKILL_BASE_URL}` and the variable is set
- **THEN** `GET /api/skills` lists the skill with that value as `baseUrl`

### Requirement: The Sources tab offers what the server lists

The Sources tab SHALL show the skills `GET /api/skills` lists and the servers `GET /api/mcp` lists, plus the
user's own server entries. A skill the server does not list SHALL be absent from the tab, from the prompt's
skill catalogue, and from `list_skills`, and `load_skill` SHALL refuse its id. When the skills route fails, the
tab SHALL list no skill and say that the server reported none.

#### Scenario: A skill withheld by the operator (manual)

- **WHEN** `SOURCES` lists `playground-env` and not `solana-dev`, and the user connects any backend
- **THEN** the tab shows one skill, the prompt's catalogue names only `playground-env`, and
  `load_skill` with `solana-dev` returns an error string naming the id

#### Scenario: The skills route is unreachable (manual)

- **WHEN** `GET /api/skills` fails
- **THEN** the tab lists no skill and shows a note that the server reported none, and the turn's prompt lists
  no skill

### Requirement: Every source has a checkbox

The Sources tab SHALL show, for every skill and every server, gateway or user-added, a checkbox whose accessible
name is the source's name, checked when the source is on. A server switched off SHALL contribute no tools to
the next turn and SHALL show no console; a skill switched off SHALL be absent from the prompt's catalogue and
from `list_skills`, and `load_skill` SHALL refuse its id. Switching a user-added server SHALL set its `enabled`
field, so the JSON editor shows the same state, unless the editor holds an unapplied draft. The editor keeps the
accessible name `MCP server configuration`.

#### Scenario: A gateway server switched off (manual)

- **WHEN** the user unchecks the gateway server `solana` and sends a message
- **THEN** the turn declares no tool from `solana`, its console is gone, and the row stays with its checkbox
  unchecked

#### Scenario: A user-added server switched on (manual)

- **WHEN** the user applies an entry `extra` with `"enabled": false` and then checks it
- **THEN** its console appears, its tools are discovered, and the editor shows the entry with
  `"enabled": true`

#### Scenario: A toggle while the editor is dirty (manual)

- **WHEN** the editor holds an unapplied edit and the user unchecks a user-added server
- **THEN** the server is off and the editor's draft is unchanged

#### Scenario: A skill switched off (manual)

- **WHEN** the user unchecks `solana-dev` and sends a message
- **THEN** the prompt's catalogue names no `solana-dev`, and `load_skill` with `solana-dev` returns an error
  string naming the id

### Requirement: The selection lives in memory

The selection SHALL NOT be persisted: after a reload every listed source is on, and a user-added server is on or
off as its `enabled` field says.

#### Scenario: A reload after switching a server off (manual)

- **WHEN** the user unchecks `solana` and reloads the page
- **THEN** `solana` is checked

### Requirement: A model without tool support gets none

A model provider profile SHALL declare whether its turns take tools. When it does not, a turn SHALL declare no
tool, skills included, and the Sources tab SHALL show one sentence saying tools are unavailable on that provider
in place of the skills and server lists.

#### Scenario: A profile that declares no tool support (manual)

- **WHEN** the connected provider's profile declares no tool support and the user sends a message
- **THEN** the request carries no tools, and the Sources tab shows the sentence and no checkbox

### Requirement: A skill entry may start switched off

A skill entry MAY carry `enabled: false`. Such a skill SHALL be listed by the skills route and shown in the
Sources tab with its checkbox unchecked, and SHALL be absent from the prompt's skill catalogue and refused by
`load_skill` until the user checks it. A skill entry without `enabled` SHALL start checked.

#### Scenario: A community skill that starts off (manual)

- **WHEN** the shipped catalogue lists a community skill with `enabled: false` and the user opens the Sources tab
- **THEN** the skill's checkbox is unchecked, the prompt's catalogue does not name it, and after the user checks
  it the next turn's catalogue names it

### Requirement: Every caller gets the community skills, switched off

Every community skill in the shipped catalogue SHALL carry `enabled: false` and SHALL NOT be marked `signedIn`.
The skills route SHALL list them to every caller, signed in or not, so a user with their own key sees the same
community skills, unchecked, as a signed-in user on the default backend.

#### Scenario: A user with their own key (manual)

- **WHEN** no `SOURCES` is set, a signed-out user connects a provider with their own key, and opens the Sources
  tab
- **THEN** every community skill is listed unchecked, the prompt's catalogue names none, and after the user
  checks one the next turn's catalogue names it and `load_skill` loads it

### Requirement: A community skill is pinned to a commit

Every remote skill in the shipped catalogue other than `solana-dev` SHALL have a `baseUrl` on
`raw.githubusercontent.com` whose path holds a full 40-character commit hash, so the text the model reads cannot
change without a change to the catalogue.

#### Scenario: A community skill loads from its pinned commit (manual)

- **WHEN** the user checks a community skill and the model calls `load_skill` with its id
- **THEN** the browser fetches `SKILL.md` from that skill's `baseUrl`, a URL that names a commit rather than a
  branch

### Requirement: The Sources tab links the entry format

The Sources tab SHALL show a help tip beside the skills heading and beside the additional-servers heading, and an
"Entry format" link in each section's description. Each link SHALL open the section of
`client-v2/docs/agent-sources-and-tools.md` that describes that kind of entry.

#### Scenario: Help for a skill entry (manual)

- **WHEN** the user follows the skills section's "Entry format" link
- **THEN** the page opens at the "Skill entries" heading
