# Spec Delta

## Purpose

How the IDE's panels are arranged, what of that arrangement survives a
reload, how it changes with the width of the screen, and where the editor is
read-only.

## ADDED Requirements

### Requirement: The layout survives a reload

The product SHALL restore, after a reload on the same device, which panels
were open and the sizes the user dragged them to. A saved layout it cannot
read SHALL give the default layout without breaking the page.

#### Scenario: A resized assistant and an open console

- **WHEN** a user widens the assistant, opens the console and reloads
- **THEN** the assistant has the width it was given and the console is open

#### Scenario: An unreadable saved layout

- **WHEN** the saved layout is corrupt and the user loads the product
- **THEN** the default layout appears and the product works

### Requirement: Panels fold without losing their state

Folding a panel SHALL hide it without discarding what it holds.

#### Scenario: Folding the console

- **WHEN** a user runs a command in the console, folds it and opens it again
- **THEN** the terminal shows the same session and its output

#### Scenario: Folding the project panel

- **WHEN** a user presses ⌘B with the project panel open, then again
- **THEN** the panel folds to a rail of icons, then opens at its full width

### Requirement: Phones read, wider screens edit

Below 600 px wide the code editor SHALL be read-only and SHALL say why when
the user tries to type. From 600 px it SHALL edit. The assistant SHALL be
usable at every width.

#### Scenario: A phone

- **WHEN** a user opens a project on a 375 px wide screen and types in the
  editor
- **THEN** the code does not change, a message says editing works from 600
  px, and the assistant opens and accepts a prompt

#### Scenario: A portrait iPad

- **WHEN** a user opens a project on a 768 px wide screen and types in the
  editor
- **THEN** the code changes

### Requirement: One layout

The product SHALL offer one layout. The `?classic` URL parameter SHALL have
no effect.

#### Scenario: The classic parameter

- **WHEN** a user opens the product with `?classic` in the URL
- **THEN** the same layout appears as without it

### Requirement: The layout is measured

The product SHALL send `layout_viewport` with the `viewport` class (`wide`,
`compact` or `phone`) once per page load; `layout_panel_toggled` with the
panel, whether it is now open, and whether a button, a key, a drag of the
panel's edge or the product itself did it (the product opens the console on a
deploy and the assistant on "Fix with assistant", and closes the project
Sheet when a modal opens, since the Sheet would keep focus from the modal);
`layout_readonly_edit_blocked` the first time in a page load that a user
tries to type in a read-only editor; and `layout_restore_failed` with the
reason when a saved layout cannot be read.

#### Scenario: Toggling the assistant by key

- **WHEN** a user presses Ctrl+R with the assistant open
- **THEN** `layout_panel_toggled` is sent with the assistant, closed, by key

#### Scenario: A corrupt saved layout is reported

- **WHEN** the saved layout is corrupt and the user loads the product
- **THEN** `layout_restore_failed` is sent with the reason `corrupt`
