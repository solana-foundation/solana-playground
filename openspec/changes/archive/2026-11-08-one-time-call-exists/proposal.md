## Why

A learner who takes a tutorial a second time with the same wallet already has the account a one-time call creates. When
that call is not the step's goal (the counter fixture's `initialize` before the goal `increment`, Zero Copy's
`init_big_map` before `paint`), the System Program refuses it as "already in use" and the lesson stops on the card: the
next beat never posts (HOO-2730).

## What Changes

- A `call` act MAY name `call.creates`, the account its instruction creates with Anchor's `init`.
- When such an act's call is refused because that account is already in use, the run is recorded refused, its card says
  the account already exists, and the lesson goes on to the next beat. The step still passes only on its goal.
- `checkDefinition` refuses an act `creates` the step's IDL does not list for the instruction, and one on the last card
  of its beats.

## Impact

- `client-v2/src/features/tutorial-conversation/model/reducer.ts`, `entities/tutorial/model/definition/{types,check}.ts`,
  `tutorials/tutorial.schema.json`, `tutorials/AUTHORING.md`; the counter fixture and Zero Copy name their one-time call's
  account.
