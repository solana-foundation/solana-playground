# Spec Delta

## MODIFIED Requirements

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
