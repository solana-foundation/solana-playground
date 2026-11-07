# Spec Delta

## ADDED Requirements

### Requirement: A step can ship its program's IDL
A tutorial step SHALL be able to carry `idl`, the Anchor IDL of the step's
target program as one minified JSON string, generated with Anchor 1.1.2. A
step's IDL SHALL hold from that step until the next step that carries one.
Each instruction a shipped IDL names SHALL be a `pub fn` of the program's
`#[program]` module in the target of that step, with the same arguments in
the same order, and every such `pub fn` SHALL be in the IDL.

#### Scenario: A step changes the program's interface (manual)
- **WHEN** Hello Anchor's "Name argument" step adds the `name` argument to `hello`
- **THEN** that step carries an IDL whose `hello` takes `name: string`, and the earlier steps read the IDL without it

#### Scenario: The program and its IDL drift apart (manual)
- **WHEN** an author changes a step's target program and does not regenerate its IDL
- **THEN** the unit test names the step and the instruction or argument that differs
