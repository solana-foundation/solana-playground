# client-v2-editor-head Specification

## Purpose

The bar over the files column and the stage: it holds the editor's tabs and
the toggles for the file tree and the terminal, so the tree takes room only
while the user wants it.

## Requirements

### Requirement: An editor head over the files column and the stage

From 768 px wide the work area SHALL show, under the stage tabs, a 44 px
head (`#editor-head`) that spans the files column and the stage whether the
column is open or not. On the Write stage its left part SHALL hold the
editor's tab row (`#tabs`), with the wallet button at its end. Its right
end SHALL hold two toggle buttons, each an 18 px icon in a 32 px button with
an 8 px radius: "Files" (`#editor-head-files`, a folder) and "Terminal"
(`#editor-head-terminal`, `>_`). Each SHALL carry `aria-pressed`, true while
its panel is open, and SHALL take the hover fill as its pressed state. The
head's position and the toggles' positions SHALL NOT change when the files
column opens or closes. The stage bar SHALL no longer hold "Collapse project
panel" / "Expand project panel", and the files column SHALL have no head of
its own outside a lesson.

#### Scenario: The head at 1440

- **WHEN** a user opens a project on a 1440 px wide window
- **THEN** a 44 px `#editor-head` sits under the stage tabs, holds `#tabs`
  with the open file's tab, and ends with "Files" and "Terminal"; the stage
  bar has no "Expand project panel" or "Collapse project panel"

#### Scenario: Nothing in the head moves

- **WHEN** a user on a 1440 px wide window clicks "Files" in the head
- **THEN** the head's left edge, its width and the toggles' positions are
  what they were before the click

#### Scenario: The head on another stage

- **WHEN** a user on a 1440 px wide window picks the Build stage
- **THEN** the head still shows "Files" and "Terminal", and the editor's
  tab row is not shown

### Requirement: Files opens and closes the tree

"Files" in the head SHALL open the file tree as a column left of the stage,
under the head, 240 px wide by default and resizable as before, with a 1 px
line on its right, its rows 28 px at 13 px, the open file highlighted, and
"+ New file" at its foot. A second click SHALL close it, and a closed column
SHALL take no width. The tree SHALL keep its open folders, selection and
scroll across a close and an open. ⌘E and the empty editor's "Show files"
SHALL keep opening it. In a lesson the column SHALL keep its Steps / Files
switch at its top, and "Files" in the head SHALL open and close that same
column.

#### Scenario: Opening and closing the tree

- **WHEN** a user on a 1440 px wide window clicks "Files" in the head, then
  clicks `lib.rs` in the tree, then clicks "Files" again
- **THEN** the tree opens left of the stage with `aria-pressed="true"` on
  "Files", the editor shows `lib.rs` with its row highlighted, then the
  column takes no width and "Files" reads `aria-pressed="false"`

#### Scenario: The key and the head agree

- **WHEN** a user with the tree closed presses ⌘E
- **THEN** the tree opens and "Files" in the head reads `aria-pressed="true"`

#### Scenario: File actions from the tree

- **WHEN** a user opens the tree from the head, clicks "+ New file", types
  `y.rs` and presses Enter, then renames and deletes `y.rs` from its menu
- **THEN** each action works as it did in the files column

### Requirement: Terminal opens and closes the console

"Terminal" in the head SHALL open the console under the stage when it is
folded and fold it when it is open, as Ctrl+J and the console's own bar do,
and its `aria-pressed` SHALL follow the console whichever control moved it.

#### Scenario: The terminal from the head

- **WHEN** a user on a 1440 px wide window clicks "Terminal" in the head,
  then presses Ctrl+J
- **THEN** the console opens and "Terminal" reads `aria-pressed="true"`,
  then the console folds to its bar and "Terminal" reads
  `aria-pressed="false"`

### Requirement: The tree starts closed

A first visit, with no saved layout, SHALL open with the files column
closed. A saved layout SHALL keep the column as it was saved, open or
closed.

#### Scenario: A first visit

- **WHEN** a user with no saved layout opens a project on a 1440 px wide
  window
- **THEN** no file tree is shown, the stage starts at the assistant's edge,
  and "Files" reads `aria-pressed="false"`

#### Scenario: A saved open tree

- **WHEN** a user whose saved layout has the files column open reloads
- **THEN** the tree is open under the head

### Requirement: The phone is unchanged

Below 768 px the product SHALL show no editor head; the phone's Files page
and its code head SHALL work as before.

#### Scenario: A phone

- **WHEN** a user opens a project on a 390 px wide screen
- **THEN** no `#editor-head` is in the page and the Files page opens from
  the code head's files row
