## ADDED Requirements

### Requirement: A one-time call on an existing account moves the lesson on

A `call` act whose `call` names `creates` SHALL send that account with its call, before any `creates` of the step's goal.
When the System Program refuses the act's instruction because that account is already in use, the run SHALL be recorded
refused, its result card SHALL say the account already exists on devnet, and the lesson SHALL post the next beat. The
step SHALL NOT pass on it unless its goal does. A refusal for any other reason, or for another account, SHALL stay a
failure, explained as any other.

#### Scenario: The counter's second pass (manual)

- **GIVEN** the counter fixture, finished once with this wallet
- **WHEN** the learner presses **Call initialize** on step 2 and the System Program refuses it with "already in use"
- **THEN** the card says `counter` already exists on devnet, the **Call increment** card posts, and step 2 passes only
  once `increment` lands

#### Scenario: A refusal for another reason (manual)

- **WHEN** the `initialize` act fails for a reason other than its account being in use
- **THEN** the run is a failure, explained as any other, and no further beat posts
