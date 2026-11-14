# client-v2-layout Specification

## Purpose

How client-v2 lays out the app and its navigation: the project list, New project and the controls they hold, and what each row and field says about its state.

## Requirements

### Requirement: The project name says what is wrong under the field

Start from scratch SHALL be a short form: a title, then a "Framework" row and
a "Name" row, each with its label, Start at the end of the Name row. A
message about the project name SHALL show under the name field, linked to it
with `aria-describedby`, and SHALL name the rule ("Use letters, numbers,
spaces, - or \_."); showing it SHALL move nothing above it. The field SHALL be
marked invalid with a red edge while the message shows. A valid name SHALL
get no edge of its own: the field stays quiet while the name is fine.
Whether a name is taken SHALL still be checked on Start only, and typing
SHALL clear the message.

#### Scenario: An invalid name (manual)

- **WHEN** a user types `my.project` and presses Start
- **THEN** the message "Use letters, numbers, spaces, - or \_." shows under the
  name field, the field is `aria-invalid` and described by the message, and
  no project is created

#### Scenario: A valid name (manual)

- **WHEN** a user types `my-project`
- **THEN** no message shows and the field has no red or green edge

#### Scenario: An empty name (manual)

- **WHEN** the name field is empty
- **THEN** it takes the placeholder and has no red edge

### Requirement: A started lesson shows its progress in the list

In the project list, a started lesson's row SHALL show the page it is on out
of its page count as "<page> of <pages>" (for example "3 of 5"), and a finished
lesson's row SHALL show a check, at the row's end where the pin and the sync
marker sit, hidden with them on hover and focus. The row SHALL be described
to assistive technology as "Page <page> of <pages>" or "Completed", and its
name SHALL stay its accessible name. A project that is not a lesson SHALL show
no progress. Progress whose saved page cannot be read SHALL show as page 1.
The open lesson's row, and its card in the tutorials list, SHALL follow its
page as the user turns it, without waiting for the page to be saved.

#### Scenario: A lesson part way through (manual)

- **WHEN** a user on page 3 of the 5 pages of Hello Anchor looks at the list
- **THEN** the Hello Anchor row shows "3 of 5" and is described as "Page 3 of 5"

#### Scenario: A finished lesson (manual)

- **WHEN** a user has finished Hello Anchor
- **THEN** its row shows a check and is described as "Completed"

#### Scenario: The open lesson's row follows its page (manual)

- **WHEN** a user on page 2 of Hello Anchor goes on to page 3
- **THEN** the Hello Anchor row shows "3 of <pages>" without a reload

#### Scenario: A project has no progress (manual)

- **WHEN** a user looks at the row of a project that is not a lesson
- **THEN** it shows no page count and no check

### Requirement: The phone editor scrolls as a phone does

Below 768 px the code editor SHALL show no minimap and no overview ruler, and
its scrollbar SHALL be a 3 px rounded slider, 3 px in from the edge, with no
track, shown only while the code moves and faded once it stops; scrolling
SHALL be smooth. A wider screen keeps the editor's minimap, overview ruler and
default scrollbar.

#### Scenario: The editor on a phone

- **WHEN** a file is open in the editor on a 390 px wide screen
- **THEN** no minimap and no overview ruler are drawn
- **AND** the scrollbar shows as a thin pill only while the code scrolls

#### Scenario: The editor on a desk

- **WHEN** a file is open in the editor on a 1440 px wide screen
- **THEN** the minimap and the overview ruler are drawn

### Requirement: A new project starts from Anchor or Native

Start from scratch's "Framework" row SHALL offer Anchor and Native, in that
order, with Anchor chosen when the page opens, and SHALL NOT offer Seahorse,
which is deprecated upstream. The Home page's New project tile SHALL read
"Anchor or Native". Seahorse projects that already exist, and the Seahorse
tutorials, SHALL open and build as before.

#### Scenario: Start from scratch without Seahorse (manual)

- **WHEN** a user opens New project
- **THEN** Start from scratch's Framework row shows Anchor and Native, Anchor
  chosen, and no Seahorse
- **AND** the Home page's New project tile reads "Anchor or Native"

### Requirement: A project's work column has one bar

From 768 px wide, an open project SHALL draw no stage bar
(`[data-slot="stage-bar"]`) over its work column: the stage tabs and the
editor head are all that sit over the stage. The project's name SHALL be
shown in the assistant's head instead. Home and the cover pages SHALL keep
their bar, titled as before. The assistant's toggle SHALL NOT be in the
editor head while the assistant is shown, wide or as the Sheet below
1024 px.

#### Scenario: No stage bar in a project

- **WHEN** a user opens `e2e-project` on a 1440 px wide window
- **THEN** no `[data-slot="stage-bar"]` is in the work column and the
  assistant's head reads "e2e-project"

#### Scenario: Home keeps its bar

- **WHEN** a user opens Home
- **THEN** the bar over the page reads "Home"

### Requirement: The stage tabs row meets the assistant's head

From 768 px wide, an open project's stage tabs (Write, Build, Deploy,
Interact) SHALL sit in a 44 px row at the top of the work column with a
1 px line under it, so its line meets the assistant's head's line.

#### Scenario: The lines meet

- **WHEN** a user opens a project on a 1440 px wide window
- **THEN** the stage tabs row is 44 px tall and its bottom line is level
  with the assistant head's bottom line
