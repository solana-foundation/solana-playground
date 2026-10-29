# assistant-patch-undo Specification

## Purpose
Lets a person take back a patch they applied from the assistant's card in one step, without leaving the panel.

## Requirements

### Requirement: An applied patch can be undone from its card
After Apply, a patch card SHALL offer a button named "Undo patch" while the file still holds what the patch wrote, in the browser tab that applied it. On a phone the button SHALL be at least 44 px tall and wide.

#### Scenario: Undo patch is offered after Apply (manual)
- **WHEN** the person applies a patch to `src/lib.rs`
- **THEN** the card reads "Applied" and shows a button named "Undo patch"

#### Scenario: Undo is not offered for a patch restored from history (manual)
- **WHEN** the page is reloaded after a patch was applied
- **THEN** the restored card reads "Applied" and shows no "Undo patch"

### Requirement: Undo puts the file back as it was
Pressing "Undo patch" SHALL restore the file's content from before Apply, or delete the file when the patch created it, and the card SHALL read "Undone" with no "Undo patch". The `assistant` widget SHALL send `assistant_patch_undone` with `via: "card"` once the file is written back.

#### Scenario: Undoing an edit
- **WHEN** the person presses "Undo patch" on a patch that changed `src/lib.rs`
- **THEN** `src/lib.rs` holds its content from before Apply, the card reads "Undone", and `assistant_patch_undone` is sent once with `via: "card"`

#### Scenario: Undoing a created file (manual)
- **WHEN** the person presses "Undo patch" on a patch that created `src/new.rs`
- **THEN** `src/new.rs` no longer exists and the card reads "Undone"

#### Scenario: A build ran after Apply (manual)
- **WHEN** a build wrote the program's id into `declare_id!` after Apply, and the person presses "Undo patch"
- **THEN** the file is back as it was before Apply except that it keeps the id the build wrote, since a build's id is not an edit

### Requirement: Undo never drops a later edit
When the file no longer holds what the patch wrote, the card SHALL NOT offer "Undo patch"; if it is pressed after such an edit, nothing SHALL be written and the thread SHALL say "You edited <path> after applying. Use undo in the editor."

#### Scenario: The file was edited after Apply (manual)
- **WHEN** the person edits `src/lib.rs` after applying a patch to it and then presses "Undo patch"
- **THEN** `src/lib.rs` keeps the edit and the thread shows "You edited src/lib.rs after applying. Use undo in the editor."
