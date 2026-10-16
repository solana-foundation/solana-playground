# Spec Delta

## ADDED Requirements

### Requirement: The production bundle carries no in-source test code

The production bundle SHALL contain no in-source test block. CI SHALL fail when
a test title that exists only inside a block is found in the built JavaScript,
and SHALL fail when that title is no longer found in `src/`, so a renamed test
cannot empty the check.

#### Scenario: The bundle is checked after the build (manual)

- **WHEN** CI builds the production bundle
- **THEN** a CI step finds each of three named test titles in `src/` and in
  none of the files under `build/static/js`, and fails the run otherwise

#### Scenario: A block in the development bundle (manual)

- **WHEN** the development server serves a module that carries a block
- **THEN** the served JavaScript holds none of the block's test titles
