# assistant-tool-registry Specification

## Purpose
Defines the one declared set of built-in tools the assistant offers,
readable by both the browser panel and the server rail, so the default agent
and a user on their own key get the same assistant. The skills and MCP
servers a deployment offers are the sources catalogue's
(`shared/config/sources.mjs`, change `sources-catalogue`), not this
registry's.

Its scenarios are checked by unit tests, not in the browser, so they carry
the `(manual)` mark: `src/entities/agent-tools/model/registry.test.mjs`
(`yarn test-api`) and `src/views/sidebar/assistant/model/tools-registry.test.ts`
(`yarn test-unit`), both under `client-v2/`.

## Requirements

### Requirement: The registry declares every built-in tool once

The registry SHALL declare each built-in tool (`read_file`,
`get_build_error`, `write_file`, `build`, `deploy`, `list_skills`,
`load_skill`, `read_skill_reference`) exactly once, with its name, the
description the model reads, a JSON Schema object for its arguments, and
whether it needs the user's approval. Names SHALL be unique. No tool SHALL
list the project's files: `read_file`'s description SHALL say it reads only
files in the conversation's context.

#### Scenario: Every built-in tool is declared (manual)

- **WHEN** a unit test reads the registry's tool declarations
- **THEN** it finds exactly the eight names above, each once, each with a
  non-empty description and an object schema with `additionalProperties: false`

#### Scenario: Tools that change state are marked (manual)

- **WHEN** a unit test reads the declarations
- **THEN** `write_file`, `build` and `deploy` are marked as needing approval
  and every other built-in tool is not

### Requirement: Server code can import the registry without a build step

The registry SHALL be importable by plain Node ESM from server code through
the slice's server door, using no path alias, no TypeScript syntax and no
browser-only module, and SHALL expose the same declarations as its browser
door.

#### Scenario: Node imports the server door (manual)

- **WHEN** a test running in the Node environment imports the slice's
  `server.mjs`
- **THEN** it gets the tool declarations, equal to what the browser door
  exports

### Requirement: The panel offers exactly the declared tools

The panel's built-in tools SHALL be the registry's declarations with a runner
bound to each, taking name, description and schema from the registry
unchanged. A declared name without a runner, or a runner without a declared
name, SHALL fail the unit tests. Tools discovered from MCP servers at runtime
are not built-in and are not checked against the registry.

#### Scenario: The panel and the registry agree (manual)

- **WHEN** the unit tests compare the panel's built-in tools with the
  registry's declarations
- **THEN** the names are the same set, and each tool's description and schema
  equal its declaration

#### Scenario: A tool added on one side only (manual)

- **WHEN** a declaration is added without a runner, or a runner without a
  declaration
- **THEN** the parity test fails and names the tool

### Requirement: A tool declared as needing approval asks before acting

A panel tool whose declaration needs approval SHALL request the user's
approval before it changes anything, and SHALL change nothing when the user
declines. A tool not marked as needing approval SHALL neither ask nor change
the project, so the mark always says what the tool does.

#### Scenario: Declining a gated tool (manual)

- **WHEN** a unit test runs each tool declared as needing approval and the
  approval request is answered with a decline
- **THEN** each one requested approval and none wrote a file, built or
  deployed

#### Scenario: A tool not marked as needing approval (manual)

- **WHEN** a unit test runs each built-in tool not marked as needing approval
- **THEN** none of them shows an approval card or writes, builds or deploys
