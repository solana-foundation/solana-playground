# Spec Delta

## Purpose

How the IDE's panels are arranged, what of that arrangement survives a
reload, how it changes with the width of the screen, and what a phone shows.

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

### Requirement: A phone is three pages

Below 720 px wide the product SHALL show three pages side by side, moved
between by a swipe or by the buttons in each page's bar: the menu (the
navigation), the work page (the assistant or the code, switched by Chat and
Code) and the preview (the current stage over the console). A load SHALL
land on the work page showing the code. The code editor SHALL edit at every
width. The 720 px value SHALL be held in one place.

#### Scenario: A phone

- **WHEN** a user on a 390 px wide screen opens a project, types in the
  editor, picks another file from "Files", opens "Preview the build", goes
  "Back to the code", opens "Menu" and then Chat
- **THEN** the code changes, the other file opens, the Build stage shows
  over the console, the code is shown again, the navigation fills the
  screen, and the assistant accepts a prompt

#### Scenario: Turning a phone across 720 px

- **WHEN** a user with a file open and a command run in the console widens
  the window from 390 px to 1024 px and back
- **THEN** the same file is open with its edits, the console shows the same
  session, and the saved layout is as it was before

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
which unfolds the navigation. From 720 to 767 px the navigation
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

#### Scenario: Settings on a narrow window

- **WHEN** a user on a 740 px wide window opens the navigation's Sheet and
  taps the cluster chip
- **THEN** the Sheet closes, the settings open with focus on the cluster,
  and picking another cluster changes it

#### Scenario: Settings on a phone

- **WHEN** a user on a 390 px wide screen opens "Menu" and taps the cluster
  chip
- **THEN** the settings open with focus on the cluster, and picking another
  cluster changes it

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
`layout_page_shown` with the page (`menu`, `work` or `preview`) and whether
a swipe, a button, a key or the product moved it, each time a phone page comes
into view after the load (crossing into the phone width with the stage off
Write is the product bringing the preview into view: one `auto` event); `layout_work_view` with the view (`chat` or `code`) and
whether a button, a key or the product switched it; and `layout_restore_failed` with the
reason when a saved layout cannot be read.

#### Scenario: Toggling the assistant by key

- **WHEN** a user presses Ctrl+R with the assistant open
- **THEN** `layout_panel_toggled` is sent with the assistant, closed, by key

#### Scenario: Opening the preview on a phone

- **WHEN** a user on a 390 px wide screen taps "Preview the build"
- **THEN** `layout_page_shown` is sent with the page `preview`, by button

#### Scenario: Swiping between pages on a phone

- **WHEN** a user on a 390 px wide screen swipes from the code to the preview
- **THEN** the Build stage shows and `layout_page_shown` is sent once, with the page `preview`, by swipe

#### Scenario: A corrupt saved layout is reported

- **WHEN** the saved layout is corrupt and the user loads the product
- **THEN** `layout_restore_failed` is sent with the reason `corrupt`
