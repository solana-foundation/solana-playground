## ADDED Requirements

### Requirement: A call act can name the account it creates

A `call` act MAY carry `call.creates`, the IDL name of the account its instruction creates with Anchor's `init`.
`checkDefinition` SHALL refuse a `call.creates` that the step's shipped IDL does not list among the instruction's
accounts, and one on the last card of its beats, which leaves nothing to go on to.

#### Scenario: The counter's initialize as a definition (manual)

- **WHEN** step 2's `initialize` act is `"call": { "instruction": "initialize", "creates": "counter" }` and a beat
  follows it
- **THEN** the check passes

#### Scenario: On the last card (manual)

- **WHEN** an act with `call.creates` is the last of its step's beats
- **THEN** the check refuses its `creates`: there is no beat to go on to
