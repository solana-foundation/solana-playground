# Spec Delta

## Purpose

Defines the one declared set of built-in tools, skills and default MCP
upstreams the assistant offers, readable by both the browser panel and the
server rail, so the default agent and a user on their own key get the same
assistant.

## ADDED Requirements

### Requirement: The registry declares every built-in tool once

The registry SHALL declare each built-in tool (`list_files`, `read_file`,
`get_build_error`, `write_file`, `build`, `deploy`, `list_skills`,
`load_skill`, `read_skill_reference`) exactly once, with its name, the
description the model reads, a JSON Schema object for its arguments, and
whether it needs the user's approval. Names SHALL be unique.

#### Scenario: Every built-in tool is declared

- **WHEN** a unit test reads the registry's tool declarations
- **THEN** it finds exactly the nine names above, each once, each with a
  non-empty description and an object schema with `additionalProperties: false`

#### Scenario: Tools that change state are marked

- **WHEN** a unit test reads the declarations
- **THEN** `write_file`, `build` and `deploy` are marked as needing approval
  and every other built-in tool is not

### Requirement: Server code can import the registry without a build step

The registry SHALL be importable by plain Node ESM from server code through
the slice's server door, using no path alias, no TypeScript syntax and no
browser-only module, and SHALL expose the same declarations, skill catalogue
and default MCP upstreams as its browser door.

#### Scenario: Node imports the server door

- **WHEN** a test running in the Node environment imports the slice's
  `server.mjs`
- **THEN** it gets the tool declarations, the skill catalogue and the default
  MCP upstreams, equal to what the browser door exports

### Requirement: The panel offers exactly the declared tools

The panel's built-in tools SHALL be the registry's declarations with a runner
bound to each, taking name, description and schema from the registry
unchanged. A declared name without a runner, or a runner without a declared
name, SHALL fail the unit tests. Tools discovered from MCP servers at runtime
are not built-in and are not checked against the registry.

#### Scenario: The panel and the registry agree

- **WHEN** the unit tests compare the panel's built-in tools with the
  registry's declarations
- **THEN** the names are the same set, and each tool's description and schema
  equal its declaration

#### Scenario: A tool added on one side only

- **WHEN** a declaration is added without a runner, or a runner without a
  declaration
- **THEN** the parity test fails and names the tool

### Requirement: A tool declared as needing approval asks before acting

A panel tool whose declaration needs approval SHALL request the user's
approval before it changes anything, and SHALL change nothing when the user
declines. A tool not marked as needing approval SHALL neither ask nor change
the project, so the mark always says what the tool does.

#### Scenario: Declining a gated tool

- **WHEN** a unit test runs each tool declared as needing approval and the
  approval request is answered with a decline
- **THEN** each one requested approval and none wrote a file, built or
  deployed

#### Scenario: A tool not marked as needing approval

- **WHEN** a unit test runs each built-in tool not marked as needing approval
- **THEN** none of them shows an approval card or writes, builds or deploys

### Requirement: Skills come from the registry's catalogue

The skill picker, the skill catalogue in the system prompt, and the skill
tools SHALL list the skills the registry declares, in its order. A skill
whose files ship in the bundle SHALL have its content bound by id in the
browser, and a bundled catalogue entry with no bound content SHALL fail the
unit tests.

#### Scenario: The panel lists the declared skills

- **WHEN** the panel builds its skill list
- **THEN** it holds the registry's skills, in order, with their ids, names and
  descriptions unchanged

#### Scenario: Bundled skill without content

- **WHEN** a bundled skill is declared with no content bound to its id
- **THEN** a unit test fails naming the skill

### Requirement: The registry names the default MCP upstreams

The registry SHALL declare the MCP upstreams every deployment offers without
configuration, each with an id usable as a tool-name prefix, a display name
and an `https` URL. The public Solana Developer MCP SHALL be one of them, with
id `solana` and URL `https://mcp.solana.com/mcp`. Upstreams that need
deployment secrets are not defaults and are not declared.

#### Scenario: The Solana upstream is a default

- **WHEN** a unit test reads the default MCP upstreams
- **THEN** it finds `solana`, named "Solana Developer MCP", at
  `https://mcp.solana.com/mcp`, and every id matches `^[a-zA-Z0-9_-]+$`
