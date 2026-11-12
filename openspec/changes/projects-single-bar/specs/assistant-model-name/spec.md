## REMOVED Requirements

### Requirement: The head names the model in use

**Reason**: Almaz, 12 Nov: the head names the project; the model is not shown there.

**Migration**: The model's name stays in the composer's model button; see "The head names the project".

## ADDED Requirements

### Requirement: The head names the project

The assistant's head (`h2` in the column bar) SHALL read the open project's
name, following a rename, and "Assistant" while no project is open. It
SHALL NOT name the model; the model's display name stays in the composer's
model button.

#### Scenario: The project in the head

- **WHEN** the project `anchor-project` is open and the deployment serves
  GLM 5.3 Flash
- **THEN** the head reads "anchor-project" and does not contain
  "GLM 5.3 Flash"

#### Scenario: No project

- **WHEN** no project is open
- **THEN** the head reads "Assistant"

## MODIFIED Requirements

### Requirement: A long model name truncates and shows in full on demand

A model name that does not fit SHALL end in "…" on one line in the
composer's model button, which SHALL be at most 12rem wide. While a name is
cut, hovering it or focusing the button SHALL show the whole name in a
tooltip; a name that fits SHALL show no tooltip. The model menu SHALL show
every name in full, wrapping a long one. The whole name SHALL stay in the
button's accessible name. A project name too long for the head SHALL end in
"…" and stay whole in the heading's accessible name.

#### Scenario: Long name in the composer, desktop and phone

- **WHEN** the connected model's name is longer than the button can show
- **THEN** the button is at most 12rem wide and ends the name in "…", Send
  stays inside the composer, and focusing the button shows the whole name in
  a tooltip

#### Scenario: Short name shows no tooltip (manual)

- **WHEN** the model's name fits
- **THEN** hovering the model button opens no tooltip
