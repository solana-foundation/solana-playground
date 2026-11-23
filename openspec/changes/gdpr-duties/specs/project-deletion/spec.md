# Spec Delta

## ADDED Requirements

### Requirement: Deleting a project clears its name in the account

When a signed-in user deletes a project, the server SHALL set the project row's
name to the empty string in the same transaction that marks it deleted. The
row SHALL stay, so a device still holding the project is refused as before. A
tutorial started again under the same id SHALL take the name the new run
sends.

#### Scenario: The name of a deleted project is gone (manual)
- **WHEN** a signed-in user deletes the project "alice-defi"
- **THEN** the account's database holds the deleted row with an empty name

#### Scenario: A restarted tutorial is named again (manual)
- **WHEN** a signed-in user deletes a tutorial and starts it again
- **THEN** the tutorial's row is live again under the tutorial's name
