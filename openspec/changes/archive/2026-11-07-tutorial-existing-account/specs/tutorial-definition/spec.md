# Spec Delta

## ADDED Requirements

### Requirement: A call goal can name the account it creates

A `call` goal MAY carry `creates`, the IDL name of the account its instruction creates with Anchor's `init`. A goal with `creates` SHALL have a win with `existsLine`, the explanation shown when the account already exists, and a win SHALL carry `existsLine` only then. `checkDefinition` SHALL refuse a `creates` that the step's shipped IDL does not list among the instruction's accounts.

#### Scenario: Lumberjack's step 2 as a definition (manual)

- **WHEN** step 2's goal is `{ "kind": "call", "instruction": "init_player", "creates": "player" }` and its win has `existsLine`
- **THEN** the check passes

#### Scenario: creates without an existsLine (manual)

- **WHEN** a goal has `creates` and its win has no `existsLine`
- **THEN** the check names the win's missing `existsLine`

#### Scenario: An existsLine without creates (manual)

- **WHEN** a win has `existsLine` and its goal has no `creates`
- **THEN** the check refuses the `existsLine`

#### Scenario: An account the IDL does not list (manual)

- **WHEN** a goal's `creates` names an account the step's IDL does not list for the instruction
- **THEN** the check refuses the `creates`
