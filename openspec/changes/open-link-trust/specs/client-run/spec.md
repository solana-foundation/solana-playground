## ADDED Requirements

### Requirement: The first Run of a link's code asks first

When a docs link opened the project, the first press of Run SHALL open a
dialog before anything runs and before any wallet setup. The dialog SHALL show
the file's name and code, the source the link claims, and that the code runs
with the Playground wallet. Run in the dialog runs the project; Cancel and
closing the dialog run nothing and leave the callout as it was. Once
confirmed, Run does not ask again for that link; a new link or another opened
project asks again. A project no docs link opened never shows the dialog.

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

#### Scenario: A project that switched while the dialog was open

- **WHEN** another project opens while the dialog shows
- **THEN** the dialog closes and nothing runs
