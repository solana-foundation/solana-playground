# Spec Delta

## Purpose

How a person works on the files of the open project in the Write stage: the
file tree, the editor tabs, what the editor shows with no file open, how a
refused write or move is reported, and the dialogs that delete a project or an
item.

## ADDED Requirements

### Requirement: The editor with no file open offers Files

When no tab is open, the editor SHALL show the title "No file open" and a
button "Show files". Pressing the button SHALL open the Files column on a
desktop and the Files page on a phone. The classic Resources and Tutorials home
SHALL NOT render in the Write stage.

#### Scenario: Closing the last tab
- **WHEN** the person closes every editor tab
- **THEN** the editor shows "No file open" and a "Show files" button
- **AND** no "Resources" or "Tutorials" heading renders in the editor

#### Scenario: Show files with the column folded
- **WHEN** the Files column is hidden and the person presses "Show files"
- **THEN** the Files column opens

#### Scenario: Show files on a phone (manual)
- **WHEN** the person presses "Show files" at a phone width
- **THEN** the Files page opens

### Requirement: The tab menu reads in sentence case

An editor tab's menu SHALL offer "Close", "Close others", "Close to the right"
and "Close all", in that order, with the same visibility rules as before:
"Close others" only with two or more tabs, "Close to the right" only when a tab
follows. The Close item's key hint SHALL read "Alt+W".

#### Scenario: The menu of a middle tab
- **WHEN** three tabs are open and the person opens the second tab's menu
- **THEN** the items read "Close", "Close others", "Close to the right", "Close all"

### Requirement: Deleting a project names it and says what goes

The project delete dialog SHALL be titled "Delete {name}?" and say "Its files
and its program keypair are deleted from this browser." It SHALL add "Your
progress in this lesson is lost." for a lesson project, and "It's also deleted
from your account and your other devices." when the person is signed in. Its
buttons SHALL read "Delete project" and "Cancel", and Cancel SHALL have focus
when it opens. Enter SHALL NOT confirm the delete from anywhere but the button;
on a phone, which has no Cancel, the dialog itself has focus.

#### Scenario: A signed-out scratch project
- **WHEN** a signed-out person chooses Delete on the project "counter"
- **THEN** the dialog reads "Delete counter?" with the files-and-keypair line only
- **AND** Cancel has focus

#### Scenario: Enter on a phone's delete dialog (manual)
- **WHEN** the delete dialog opens at a phone width and the person presses Enter
- **THEN** nothing is deleted

#### Scenario: A lesson while signed in (manual)
- **WHEN** a signed-in person chooses Delete on a lesson project
- **THEN** the dialog shows the lesson line and the account line

### Requirement: Deleting a file or folder names it and counts a folder's files

The item delete dialog SHALL be titled "Delete {name}?" for a file or an empty
folder, and "Delete {name} and the {n} files in it?" for a folder holding n
files at any depth ("the 1 file" for one). Its body SHALL read "You can't undo
this." and its buttons "Delete" and "Cancel", with Cancel focused.

#### Scenario: A folder with two files
- **WHEN** the person deletes `src/utils` holding `math.rs` and `io.rs`
- **THEN** the dialog reads "Delete utils and the 2 files in it?"

### Requirement: A lesson row shows the tutorial glyph

A row in the project list for a lesson project SHALL show the tutorial glyph
in place of the folder glyph. Every other row keeps the folder glyph.

#### Scenario: A lesson next to a scratch project (manual)
- **WHEN** the list holds a lesson project and a scratch project
- **THEN** the lesson's row shows the tutorial glyph and the scratch row the folder glyph

### Requirement: The project list shows skeleton rows while it loads

While the project names are still being read from browser storage, the
project list SHALL show three skeleton rows under its "Projects" heading, and
no empty message. A preview of a GitHub link, which reads no stored names,
SHALL show none.

#### Scenario: Names not read yet (manual)
- **WHEN** the project list renders before the names are read
- **THEN** three skeleton rows show and no project row renders

### Requirement: The Files column foot creates files and folders

The Files column foot SHALL offer "New file" and "New folder". Each SHALL put
a name field in the tree inside the selected folder, beside the selected file,
or in `src` with nothing selected.

#### Scenario: New folder from the foot
- **WHEN** the person presses "New folder" with nothing selected and enters "utils"
- **THEN** the folder `src/utils` is created

### Requirement: The command decides file or folder

Creating an item SHALL make a file when the person chose a new file and a
folder when they chose a new folder, whatever the name. A stored item SHALL
keep the type it was created with when its project loads again.

#### Scenario: A file without a dot
- **WHEN** the person creates a new file named "Makefile"
- **THEN** a file `Makefile` is created and opens in a tab

#### Scenario: A folder with a dot
- **WHEN** the person creates a new folder named "v1.2"
- **THEN** a folder `v1.2` is created and shows as a folder after a reload

### Requirement: A typed item name follows the name rule

A name typed for a new or renamed file or folder SHALL use only letters,
numbers, `.`, `-` and `_`, SHALL NOT start or end with a dot, and SHALL NOT
match another item in the same folder. A refused name SHALL leave the tree
unchanged and show its reason under the field: "Use letters, numbers, ., - and
_.", "A name can't start with a dot.", "A name can't end with a dot.", or
"{folder} already has a file named {name}." ("a folder" for a folder). Items
already stored under any name SHALL still load.

#### Scenario: A name with a space
- **WHEN** the person enters "my file.rs" for a new file
- **THEN** nothing is created and "Use letters, numbers, ., - and _." shows under the field

#### Scenario: A hidden name
- **WHEN** the person enters ".env" for a new file
- **THEN** nothing is created and "A name can't start with a dot." shows under the field

### Requirement: The tree menu reads in sentence case and offers Move to

A tree row's menu SHALL offer "New file", "New folder", "Rename", "Move to…"
and "Delete", in sentence case; on a file row, a new item goes beside it. On `src`, Rename, Move to…
and Delete SHALL show disabled, with the reason "src holds your program, so it
can't be renamed, moved or deleted."

#### Scenario: The menu of src
- **WHEN** the person opens the menu of `src`
- **THEN** Rename, Move to… and Delete are disabled and the reason is shown

### Requirement: Move to moves an item into a chosen folder

"Move to…" SHALL open a dialog titled "Move {name} to…" listing the project's
folders, the current one marked and not choosable. Choosing a folder by
pointer, touch or keyboard SHALL move the item there, an open tab following
it. A name taken in the target SHALL ask "{folder} already has a {name}.
Replace it?" first.

#### Scenario: Move by keyboard
- **WHEN** the person opens Move to… on `src/utils/math.rs`, types "src" and presses Enter
- **THEN** the file is at `src/math.rs` and its tab shows it there

### Requirement: A refused move is never silent

When a move by drag or by "Move to…" is refused for any reason other than a
taken name, the person SHALL see the reason in a toast and the tree SHALL stay
as it was. A taken name SHALL ask the replace question.

#### Scenario: A move the storage refuses
- **WHEN** the browser storage rejects a dragged file's move
- **THEN** a toast says the file could not be moved, with the reason
- **AND** the file stays where it was

### Requirement: The tree uses the tree pattern

The file tree SHALL be an element with `role="tree"`; each file and folder row
SHALL have `role="treeitem"` and `aria-level`, each folder row SHALL carry
`aria-expanded` matching its open state, and a folder's children SHALL sit in
an element with `role="group"`.

#### Scenario: Opening a folder
- **WHEN** the person opens the folder `src`
- **THEN** its row has `aria-expanded="true"` and its files are treeitems at level 2

### Requirement: A refused autosave write is never silent

When browser storage refuses an autosave write, the file's tab SHALL show a
"not saved" marker whose accessible name and tooltip read "Not saved. This
browser refused the change.", and the FILE-01 callout SHALL show above the
editor with "Export project". The edit SHALL stay on screen. The next accepted
write SHALL clear the marker and the callout.

#### Scenario: Storage refuses a write
- **WHEN** the person types and the storage write fails
- **THEN** the tab shows the not-saved marker and the FILE-01 callout shows

#### Scenario: The next write succeeds
- **WHEN** a later write of the same file succeeds
- **THEN** the marker and the callout are gone

### Requirement: A pending edit is written before the page goes

An edit still inside its autosave delay SHALL be written when the page fires
`pagehide`, so a reload within the delay loses nothing.

#### Scenario: Reload inside the delay
- **WHEN** the person types and reloads within 500 ms
- **THEN** the typed text is in the file after the reload
