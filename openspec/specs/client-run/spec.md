# client-run Specification

## Purpose

**Area:** the stage row's Run, the explorer's Run and Test, and the
callout above the code of a client project (client-v2 UI)

How a client project's scripts run from the stage row: Run, the callout above
the code that says how the run went, and the question Run asks before the
first run of code a docs link opened.

## Requirements

### Requirement: The first Run of a link's code asks first

When a docs link opened the project, the first press of Run SHALL open a
dialog before anything runs and before any wallet setup. The dialog SHALL show
the file's name and code, the source the link claims, and that the code runs
with the Playground wallet. Run in the dialog runs the project; Cancel and
closing the dialog run nothing and leave the callout as it was. Once
confirmed, Run does not ask again for that link; a new link or another opened
project asks again. A project that switches while the dialog shows runs
nothing. A run from the explorer's menu, and its Test on a file, ask the same
question; a bare `test` runs only `tests/`, which holds none of the link's
code, and is not asked about. A project opened after the link's, including
the link's code saved into a workspace, is the user's own and is not asked
about. A project no
docs link opened never shows the dialog.

#### Scenario: The Quickstart after one confirmation

- **WHEN** the user opens the Quickstart link and presses Run
- **THEN** the dialog shows `quickstart.ts` and its code
- **WHEN** the user presses Run in the dialog
- **THEN** the script runs
- **WHEN** the user presses Run again
- **THEN** it runs with no dialog

#### Scenario: Cancel

- **WHEN** the user presses Cancel in the dialog
- **THEN** nothing runs and no wallet setup opens
