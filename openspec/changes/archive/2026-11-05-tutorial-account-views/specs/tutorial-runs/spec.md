## ADDED Requirements

### Requirement: A landed run reads the account its act names

After a run or call landed, the runner SHALL read the account the act's `account` names from among those the run wrote to, and save its address, size in bytes and scalar fields with the result. A read that fails SHALL be reported and leave the result without a reading; the run still landed.

#### Scenario: A chop lands

- **WHEN** a `chop_tree` act with a player view lands
- **THEN** its result holds the player's address, size and `energy`, `wood` and `lastLogin` as strings

#### Scenario: The read fails

- **WHEN** the chain does not answer the read
- **THEN** the run's result is still ok and the failure is reported
