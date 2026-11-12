## MODIFIED Requirements

### Requirement: An editor head over the files column and the stage

From 768 px wide the work area SHALL show, under the stage tabs, a 44 px
head (`#editor-head`) that spans the files column and the stage whether the
column is open or not, and it SHALL be the only bar over a project's work
column: no stage bar is drawn there. On the Write stage its left part SHALL
hold the editor's tab row (`#tabs`), with the wallet button at its end. Its
right end SHALL hold, in this order: "Files" (`#editor-head-files`, a
folder) and "Terminal" (`#editor-head-terminal`, `>_`), each an 18 px icon
in a 32 px button with an 8 px radius, carrying `aria-pressed` and taking
the hover fill as its pressed state; then the project's Share button; then
"More options" (⋯) whose menu holds "Solana documentation"; and, only while
the assistant is hidden, "Expand assistant". "Files" reads
`aria-pressed="true"` while the tree is shown, docked or as the dropdown.
The head's position and the toggles' positions SHALL NOT change when the
files column opens or closes.

#### Scenario: The head at 1440

- **WHEN** a user opens a project on a 1440 px wide window
- **THEN** a 44 px `#editor-head` sits under the stage tabs, holds `#tabs`
  with the open file's tab, and ends with "Files", "Terminal", "Share" and
  "More options"; no `[data-slot="stage-bar"]` is in the work column

#### Scenario: The chat comes back from the head

- **WHEN** a user clicks "Collapse assistant" in the assistant's head, then
  "Expand assistant" in `#editor-head`
- **THEN** the assistant hides and "Expand assistant" appears at the head's
  end, then the assistant shows again and the head has no "Expand
  assistant"

#### Scenario: Nothing in the head moves

- **WHEN** a user on a 1440 px wide window clicks "Files" in the head
- **THEN** the head's left edge, its width and the toggles' positions are
  what they were before the click

#### Scenario: The head on another stage

- **WHEN** a user on a 1440 px wide window picks the Build stage
- **THEN** the head still shows "Files", "Terminal", "Share" and "More
  options", and the editor's tab row is not shown

### Requirement: Files opens and closes the tree

The project tree SHALL be shown in one of two ways, as in a tutorial:
docked, as a column left of the stage under the head (240 px wide by
default and resizable, a 1 px line on its right, "+ New file" at its foot,
and "Undock the files" at its top right), or as a dropdown under the head
(`aria-label="Files"`) holding the same tree and "+ New file", with «Dock
beside the editor» at its top right. "Files" in the head SHALL undock a
docked, shown tree, and otherwise open or close the dropdown. «Dock beside
the editor» SHALL dock the tree and close the dropdown; "Undock the files"
SHALL undock it. The pin SHALL show only while the code area is wider than
1100 px; narrower, a docked tree SHALL not take a column and "Files" opens
it as the dropdown. The tree SHALL keep its open folders, selection and
scroll across every change. ⌘E and the empty editor's "Show files" SHALL do
what "Files" does. In a lesson the column SHALL keep its Steps / Files
switch at its top, and "Files" in the head SHALL open and close that same
column.

#### Scenario: Opening and closing the tree

- **WHEN** a user on a 1440 px wide window with the tree undocked clicks
  "Files", then clicks `lib.rs` in the dropdown, then clicks "Files" again
- **THEN** the dropdown opens with `aria-pressed="true"` on "Files", the
  editor shows `lib.rs` with its row highlighted, then the dropdown closes
  and "Files" reads `aria-pressed="false"`

#### Scenario: The key and the head agree

- **WHEN** a user with the tree undocked and the dropdown closed presses ⌘E
- **THEN** the dropdown opens and "Files" in the head reads
  `aria-pressed="true"`

#### Scenario: Undocking and docking again

- **WHEN** a user on a 1440 px wide window with the tree docked clicks
  "Files", then "Files" again, then «Dock beside the editor»
- **THEN** the column takes no width and "Files" reads
  `aria-pressed="false"`, then the dropdown shows the tree with "Files" at
  `aria-pressed="true"`, then the column is back and the dropdown is closed

#### Scenario: No pin when narrow

- **WHEN** the code area is 1000 px wide and the user clicks "Files"
- **THEN** the dropdown opens with no «Dock beside the editor»

#### Scenario: File actions from the tree

- **WHEN** a user opens the tree as the dropdown, clicks "+ New file",
  types `y.rs` and presses Enter, then renames and deletes `y.rs` from its
  menu
- **THEN** each action works as it does in the docked column

### Requirement: The tree starts closed

A first visit, with no saved layout, SHALL open with the project tree
docked. A saved layout SHALL keep the tree as it was saved, docked or not.

#### Scenario: A first visit

- **WHEN** a user with no saved layout opens a project on a 1440 px wide
  window
- **THEN** the tree is docked left of the stage and "Files" reads
  `aria-pressed="true"`

#### Scenario: A saved open tree

- **WHEN** a user whose saved layout has the tree docked reloads
- **THEN** the tree is docked under the head

#### Scenario: A saved undocked tree

- **WHEN** a user whose saved layout has the tree undocked reloads
- **THEN** no column is shown and "Files" opens the dropdown

## ADDED Requirements

### Requirement: Opening the dropdown is measured

The layout SHALL send `layout_files_dropdown_opened` each time the project
tree's dropdown opens, with `via` `"button"` (the head's "Files") or
`"key"` (⌘E). Docking and undocking SHALL keep sending
`layout_panel_toggled` with `panel: "files"`, `open: true` for docked and
`false` for undocked.

#### Scenario: The dropdown from the button

- **WHEN** a user with the tree undocked clicks "Files"
- **THEN** one `layout_files_dropdown_opened` with `via: "button"` is sent
