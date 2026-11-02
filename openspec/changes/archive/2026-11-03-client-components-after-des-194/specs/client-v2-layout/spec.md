## ADDED Requirements

### Requirement: The project name says what is wrong before the field

In Start from scratch, a message about the project name SHALL show before the
name field (on its left while the controls share one row, above it when they
stack), linked to it with `aria-describedby`, without moving the field off the
row's centre line, and the field SHALL be
marked invalid with a red edge. A typed name that passes the format check
(letters, digits, spaces, `-` and `_`) SHALL give the field a success edge
(`data-state="valid"`); an empty field, which takes the placeholder, SHALL
have neither edge. Whether a name is taken SHALL still be checked on Start
only, and typing SHALL clear the message.

#### Scenario: An invalid name (manual)

- **WHEN** a user types `my.project` and presses Start
- **THEN** the message shows before the name field, the field is
  `aria-invalid` and described by the message, and no project is created

#### Scenario: A valid name (manual)

- **WHEN** a user types `my-project`
- **THEN** the name field has the success edge and no message shows

#### Scenario: An empty name (manual)

- **WHEN** the name field is empty
- **THEN** it has neither the success nor the invalid edge

### Requirement: A started lesson shows its progress in the list

In the project list, a started lesson's row SHALL show the page it is on out
of its page count as "<page>/<pages>" (for example "3/5"), and a finished
lesson's row SHALL show a check, at the row's end where the pin and the sync
marker sit, hidden with them on hover and focus. The row SHALL be described
to assistive technology as "Page <page> of <pages>" or "Completed", and its
name SHALL stay its accessible name. A project that is not a lesson SHALL show
no progress. Progress whose saved page cannot be read SHALL show as page 1.
The open lesson's row, and its card in the tutorials list, SHALL follow its
page as the user turns it, without waiting for the page to be saved.

#### Scenario: A lesson part way through (manual)

- **WHEN** a user on page 3 of the 5 pages of Hello Anchor looks at the list
- **THEN** the Hello Anchor row shows "3/5" and is described as "Page 3 of 5"

#### Scenario: A finished lesson (manual)

- **WHEN** a user has finished Hello Anchor
- **THEN** its row shows a check and is described as "Completed"

#### Scenario: The open lesson's row follows its page (manual)

- **WHEN** a user on page 2 of Hello Anchor goes on to page 3
- **THEN** the Hello Anchor row shows "3/<pages>" without a reload

#### Scenario: A project has no progress (manual)

- **WHEN** a user looks at the row of a project that is not a lesson
- **THEN** it shows no page count and no check
