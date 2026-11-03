# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: The project name says what is wrong before the field`
- TO: `### Requirement: The project name says what is wrong under the field`

## MODIFIED Requirements

### Requirement: The project name says what is wrong under the field

Start from scratch SHALL be a short form: a title, then a "Framework" row and
a "Name" row, each with its label, Start at the end of the Name row. A
message about the project name SHALL show under the name field, linked to it
with `aria-describedby`, and SHALL name the rule ("Use letters, numbers,
spaces, - or _"); showing it SHALL move nothing above it. The field SHALL be
marked invalid with a red edge while the message shows. A valid name SHALL
get no edge of its own: the field stays quiet while the name is fine.
Whether a name is taken SHALL still be checked on Start only, and typing
SHALL clear the message.

#### Scenario: An invalid name (manual)

- **WHEN** a user types `my.project` and presses Start
- **THEN** the message "Use letters, numbers, spaces, - or _" shows under the
  name field, the field is `aria-invalid` and described by the message, and
  no project is created

#### Scenario: A valid name (manual)

- **WHEN** a user types `my-project`
- **THEN** no message shows and the field has no red or green edge

#### Scenario: An empty name (manual)

- **WHEN** the name field is empty
- **THEN** it takes the placeholder and has no red edge
