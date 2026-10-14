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

#### Scenario: A layout saved before the four columns

- **WHEN** a user whose saved layout is from the version with the header
  (project panel folded, console open) loads the product
- **THEN** the files column is folded, the console is open, the navigation
  is open, and the saved layout is rewritten in the current version

#### Scenario: An unreadable saved layout

- **WHEN** the saved layout is corrupt and the user loads the product
- **THEN** the default layout appears and the product works

### Requirement: Panels fold without losing their state

Folding a panel SHALL hide it without discarding what it holds.

#### Scenario: Folding the console

- **WHEN** a user runs a command in the console, folds it and opens it again
- **THEN** the terminal shows the same session and its output

#### Scenario: Folding the project panel

- **WHEN** a user presses ⌘E with the files column ("Collapse project
  panel") open, then again
- **THEN** the column folds to a rail holding "Expand project panel" and
  "New file", then opens at its full width

#### Scenario: Folding the navigation

- **WHEN** a user presses ⌘B with the navigation open, then again
- **THEN** the navigation folds to a rail of icons, then opens at its full
  width

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

### Requirement: Four columns and no header

From 1024 px wide the product SHALL show, left to right, the navigation, the
assistant, the files column, and the stage over the console, with the stage
bar (`flow-stage-tab-*`: Write, Build, Deploy, Interact) across the files
column and the stage. There SHALL be no top header: the project switcher
SHALL be in the navigation and the cluster, wallet and settings controls in
its footer. Between 768 and 1023 px the navigation SHALL start as a rail on
every load and the
assistant a Sheet opened by "Expand assistant". The rail's footer SHALL hold
the cluster's dot, coloured by whether the cluster answers and named "Cluster:
<name>", which opens the settings on the cluster, and an "Account" button,
which unfolds the navigation. Below 768 px the navigation
and the files column SHALL share one Sheet opened by "Expand project panel",
and opening the settings from its footer SHALL close that Sheet, whose overlay
would otherwise cover the settings and keep focus from them.

#### Scenario: A wide window

- **WHEN** a user opens a project on a 1280 px wide window
- **THEN** the navigation, the assistant, the files column holding
  `#root-dir`, and the stage over the console sit side by side in that
  order, the stage tabs sit above the files column and the stage, and no
  header is shown

#### Scenario: Everything the header did

- **WHEN** a user on a 1280 px wide window switches the project, opens the
  settings and picks a stage by Ctrl+2
- **THEN** each works from its new place: the switcher in the navigation,
  the settings from the navigation's footer, and the Build stage opens

#### Scenario: A tablet

- **WHEN** a user opens a project on an 834 px wide window
- **THEN** the navigation is a rail, the files column and the stage are
  shown, and "Expand assistant" opens the assistant in a Sheet

#### Scenario: The rail's footer

- **WHEN** a user on an 834 px wide window clicks the cluster's dot at the
  foot of the rail, clicks it again, then clicks "Account"
- **THEN** the settings open with focus on the cluster, then close, and the
  navigation opens at its full width with the cluster chip in its footer

#### Scenario: Settings on a phone

- **WHEN** a user on a 375 px wide window opens the navigation's Sheet and
  taps the cluster chip
- **THEN** the Sheet closes, the settings open with focus on the cluster,
  and picking another cluster changes it

### Requirement: The navigation opens the gallery

Until Home and the Tutorials and Programs pages exist, the navigation's
items SHALL open the gallery: Home and New project on its default tab,
Tutorials on its tutorials tab (`gallery-tab-tutorials`), Programs on its
programs tab (`gallery-tab-programs`).

#### Scenario: Programs from the navigation

- **WHEN** a user clicks Programs in the navigation
- **THEN** the gallery opens with its programs tab selected

### Requirement: The navigation is measured

The navigation SHALL send `nav_item_opened` with `item` (`home`,
`new-project`, `tutorials` or `programs`) each time a user picks one of its
items.

#### Scenario: Picking Tutorials

- **WHEN** a user clicks Tutorials in the navigation
- **THEN** `nav_item_opened` is sent with `item` `tutorials`

### Requirement: One layout

The product SHALL offer one layout. The `?classic` URL parameter SHALL have
no effect.

#### Scenario: The classic parameter

- **WHEN** a user opens the product with `?classic` in the URL
- **THEN** the same layout appears as without it

### Requirement: The layout is measured

The product SHALL send `layout_viewport` with the `viewport` class (`wide`,
`compact` or `phone`) once per page load; `layout_panel_toggled` with the
panel (`nav`, `files`, `assistant` or `console`; the files column's earlier
name, `left`, is not sent), whether it is open, and whether a button, a key, a
drag of the panel's edge or the product itself did it (the product opens the
console on a deploy and the assistant on "Fix with assistant", and closes the
navigation's Sheet when a modal opens or the settings open from it, since the
Sheet would keep focus from them);
`layout_readonly_edit_blocked` the first time in a page load that a user
tries to type in a read-only editor; and `layout_restore_failed` with the
reason when a saved layout cannot be read.

#### Scenario: Toggling the assistant by key

- **WHEN** a user presses Ctrl+R with the assistant open
- **THEN** `layout_panel_toggled` is sent with the assistant, closed, by key

#### Scenario: A corrupt saved layout is reported

- **WHEN** the saved layout is corrupt and the user loads the product
- **THEN** `layout_restore_failed` is sent with the reason `corrupt`
