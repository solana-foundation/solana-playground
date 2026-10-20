# Spec Delta

## ADDED Requirements

### Requirement: The production bundle carries no in-source test code

The production bundle SHALL contain no in-source test block. CI SHALL fail,
through the build tests that read `build/`, when any test title from any
block is found in the built JavaScript.

#### Scenario: The bundle is checked after the build (manual)

- **WHEN** CI builds the production bundle and runs the build tests
- **THEN** the build test collects the test titles of every block under `src/`
  and fails, naming the chunk, the title, and the module, when a title is in a
  file under `build/static/js`

#### Scenario: A block in the development bundle (manual)

- **WHEN** the development server serves a module that carries a block
- **THEN** the served JavaScript holds none of the block's test titles
