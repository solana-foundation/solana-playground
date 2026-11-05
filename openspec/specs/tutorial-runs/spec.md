# tutorial-runs Specification

## Purpose
How a conversation tutorial's acts run for real (build, deploy, client runs and calls on devnet) and how a step's goal is judged on what actually happened.

## Requirements

### Requirement: A refused call passes the step that expects it

A failed run or call SHALL report what the program refused when its
transaction reached the program: the refused instruction and, when the program
returned one, its error's code and name. A step whose goal is `refused` SHALL
pass when such a result names the goal's instruction and:

- its error matches the goal's error (each of the name and the code the goal
  gives), when the goal gives one;
- its transaction log matches the goal's pattern, when the goal gives one.

A result that never reached the program (no wallet, a send that failed) SHALL
pass no `refused` goal. A refusal that passes the step SHALL be recorded as
refused, not failed, and its card SHALL offer neither Explain nor "I'll fix it
myself". A refusal that does not meet the step's goal SHALL stay a failure,
explained as any other. The call act, the client run and the Call panel SHALL
pass the same goal, and a confirmed call SHALL pass no `refused` goal.

#### Scenario: Out of energy

- **WHEN** on Lumberjack's step 3 a chop is refused with `NotEnoughEnergy`
  6000
- **THEN** step 3 passes and its win follows

#### Scenario: Out of memory, not too big

- **WHEN** on Zero Copy's step 2, whose goal is `refused` on `grow` with the
  pattern `out of memory`, a grow is refused because it added more than
  10 KB at once
- **THEN** the step does not pass and the refusal is a failure
- **AND** a later grow refused with "memory allocation failed, out of memory"
  in its log passes it

### Requirement: A landed run reads the account its act names

After a run or call landed, the runner SHALL read the account the act's `account` names from among those the run wrote to, and save its address, size in bytes and scalar fields with the result. A read that fails SHALL be reported and leave the result without a reading; the run still landed.

#### Scenario: A chop lands

- **WHEN** a `chop_tree` act with a player view lands
- **THEN** its result holds the player's address, size and `energy`, `wood` and `lastLogin` as strings

#### Scenario: The read fails

- **WHEN** the chain does not answer the read
- **THEN** the run's result is still ok and the failure is reported
