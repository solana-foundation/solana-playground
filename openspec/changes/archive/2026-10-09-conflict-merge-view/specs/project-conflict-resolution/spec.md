# Spec Delta

## Purpose

What a signed-in user sees and can do when this device and another device
changed the same lines of a project, and what reaches this device's files,
the account and the other device once they answer.

## ADDED Requirements

### Requirement: The divergent prompt offers to resolve line by line

When a project's divergent conflict names the files and lines both devices
changed, the sync banner SHALL offer a button named "Resolve…" that opens
the resolve view, and SHALL keep "Keep this version" and "Take the other
version". A divergent conflict that names no files SHALL keep only those two.

#### Scenario: A same-line conflict offers Resolve

- **WHEN** this device and the other device changed the same line of
  `src/lib.rs` and the project reconciles
- **THEN** the banner names `src/lib.rs` and shows the buttons "Resolve…",
  "Keep this version" and "Take the other version"

### Requirement: The view shows only what is left to decide

The resolve view SHALL be a dialog named "Resolve conflicts" with three panes
named "This device", "Result" and "Other device". Every line that merged on
its own SHALL be in all three panes; lines only one device changed SHALL be
marked as changed in "Result" and in that device's pane. Each conflicting hunk SHALL show this
device's lines on the left, the other device's on the right, and the lines
both started from in the result. Apply SHALL be disabled while any hunk is
unresolved.

#### Scenario: Opening the view on a one-line conflict

- **WHEN** the user presses "Resolve…" for a project where both devices
  changed line 12 of `src/lib.rs`, and the other device also changed line 3
- **THEN** a dialog named "Resolve conflicts" shows `src/lib.rs`, "1 conflict
  left", this device's line 12 in "This device", the other device's in
  "Other device", the original line 12 in "Result", the other device's
  line 3 in all three panes, marked as changed in "Result" and "Other
  device", and "Apply" disabled

### Requirement: Unchanged regions are folded

The view SHALL fold runs of lines that no hunk touches, keeping a few lines
of context around each hunk, and SHALL show each fold as a control naming
how many lines it hides. A toggle named "Show all lines" SHALL unfold every
region.

#### Scenario: A conflict deep in a long file

- **WHEN** the view opens on a 300-line file whose only conflict is at
  line 200
- **THEN** the lines far above and below the conflict are hidden behind
  controls that say how many lines each hides, and pressing "Show all lines"
  shows every line

### Requirement: Each hunk is taken, dismissed or edited

Each side of each hunk SHALL offer to take its lines into the result
("Take this device's lines", "Take the other device's lines") and to dismiss
them ("Dismiss this device's lines", "Dismiss the other device's lines").
Taking both sides SHALL place this device's lines first. The result SHALL be
editable. A hunk SHALL count as resolved once both its sides are taken or
dismissed, or once the user edits its lines in the result. Undo and redo in
the result SHALL take each hunk back to where it stood at that text, so an
undone take or dismissal can be decided again.

#### Scenario: Taking both sides

- **WHEN** the user takes this device's lines and then the other device's
  lines of the only hunk
- **THEN** the result holds this device's lines followed by the other
  device's, the view says no conflicts are left, and "Apply" is enabled

#### Scenario: Undoing a take

- **WHEN** the user takes this device's lines of the only hunk and presses
  undo in "Result"
- **THEN** the result holds the lines both started from, "Take this device's
  lines" is offered again, the view says 1 conflict is left, and "Apply" is
  disabled

#### Scenario: Editing the result by hand

- **WHEN** the user types a new line in place of the hunk's lines in
  "Result"
- **THEN** the hunk counts as resolved and "Apply" is enabled

### Requirement: Several files are resolved in one view

When more than one file conflicts, the view SHALL show one file at a time,
say which file of how many it is, and offer "Previous file" and "Next file".
Apply SHALL stay disabled until every hunk of every file is resolved.

#### Scenario: Two files in conflict

- **WHEN** both devices changed the same lines of `src/lib.rs` and of
  `tests/index.test.ts`, and the user resolves every hunk of `src/lib.rs`
  only
- **THEN** "Apply" stays disabled; after "Next file" and resolving
  `tests/index.test.ts`, it is enabled

### Requirement: A file without hunks is one conflict

When a conflicted file cannot be split into hunks (no copy both devices
agreed on is known, or one device deleted it), the view SHALL show the whole
file as one hunk, with a deleted side shown as an empty pane named as
deleted, and the result starting from this device's copy. Where one side
deleted the file, applying an empty result SHALL delete it when the deleting
side was taken, this device's delete was kept, or the user emptied lines by
hand; taking a side's empty file SHALL keep it as an empty file. Taking
either side of such a hunk SHALL dismiss the other, since the answer is one
file or the other, not lines from both.

#### Scenario: Deleted on the other device, edited here

- **WHEN** the other device deleted `src/old.rs` and this device edited it,
  and the user takes the other device's side and applies
- **THEN** `src/old.rs` is gone from this device's files and from the
  uploaded project

### Requirement: Apply writes and uploads the chosen text

Apply SHALL write each resolved file to this device's project, upload the
project, close the view and clear the banner. The upload SHALL be recorded
as the agreement, so that this device and the other device each take it
without asking again.

#### Scenario: Resolved hunk by hunk and applied

- **WHEN** the user takes both sides of the only hunk and presses "Apply"
- **THEN** `src/lib.rs` in the editor holds the chosen text, the account
  receives one upload holding it, the dialog closes and the banner is gone

#### Scenario: The account's copy comes back unchanged

- **WHEN** the user has applied a resolution, and the page is reloaded with
  the account holding exactly what was uploaded
- **THEN** no banner appears, no file the user resolved is uploaded again,
  and `src/lib.rs` holds the chosen text. (A reload may still upload the
  generated `.workspace/program-info.json`, which the account never
  received: a known sync gap, not part of the resolution -- see
  `account-sync`'s "reloading a project the account already has writes
  nothing".)

### Requirement: Nothing is written before Apply

Until the user presses "Apply" or a whole-file shortcut, the view SHALL NOT
change this device's files or upload anything. Closing the view, by "Cancel",
the close button or Escape, SHALL leave the conflict pending and the banner
shown.

#### Scenario: Cancelled after taking a side

- **WHEN** the user takes this device's lines, presses "Cancel", and then
  "Discard"
- **THEN** the dialog closes, `src/lib.rs` is unchanged, nothing was
  uploaded, and the banner still offers "Resolve…"

### Requirement: Choices are not lost by accident

A click outside the view SHALL NOT close it. Once the user has taken,
dismissed or typed anything, closing SHALL first ask "Discard your choices?"
with "Keep resolving" and "Discard"; Escape while it asks SHALL keep
resolving. Escape pressed inside one of the view's editors while that
editor's suggestions, search or parameter hints are open SHALL be left to the
editor, which closes them; otherwise it SHALL close the view as anywhere
else.

#### Scenario: A stray click beside the view (manual)

- **WHEN** the user has taken a side and clicks outside the dialog
- **THEN** the dialog stays open with the side still taken

### Requirement: An answer applies only to what the user saw

An applied resolution SHALL be used only if neither device's copy of each
resolved file has changed since the view showed it. Otherwise the view SHALL
not upload it, SHALL show the files' new conflicts, and SHALL say that a
file changed on the other device.

#### Scenario: The other device saves while the view is open

- **WHEN** the view is open, the account receives another change to the
  same lines of `src/lib.rs`, and the user resolves the hunk and presses
  "Apply"
- **THEN** nothing is uploaded, the view shows the other device's newer
  lines with "Apply" disabled, and a note says `src/lib.rs` changed on the
  other device

### Requirement: A refused answer's merged files wait for Apply

A file a refused answer was about that now merges on its own SHALL still be
shown, as it now merges, with nothing to decide, and SHALL NOT be written or
uploaded until the user applies again: the user answered about copies that
are gone. The banner SHALL name only the files still in conflict as changed
"in the same place", and say of the others that they changed while the user
was resolving.

#### Scenario: A refused answer's file now merges on its own (manual)

- **WHEN** the view is open on `src/lib.rs`, the other device saves a change
  to different lines of it, and the user resolves the hunk and presses
  "Apply"
- **THEN** nothing is uploaded, the view shows `src/lib.rs` as it now merges
  with nothing to decide and "Apply" enabled, and the banner says it changed
  on another device while the user was resolving

### Requirement: Whole-file answers stay as shortcuts

The view's footer SHALL offer "Keep this version" and "Take the other
version", which SHALL do exactly what the banner's buttons of the same names
do.

#### Scenario: Keeping this version from the view

- **WHEN** the user opens the view and presses "Keep this version"
- **THEN** the conflicted file keeps this device's text, every other file
  keeps its merged text, the project is uploaded and the banner is gone

### Requirement: The resolve view is measured

`features/persistence` SHALL track these events, with no parameters beyond
those listed and never a path or file content:

- `sync_resolve_opened`: the resolve view opened. `files`, how many files it
  asks about; `hunks`, how many hunks they hold in all, a whole file counting
  as one.
- `sync_resolve_hunk_resolved`: a hunk went from undecided to resolved, not
  by undo or redo. `how`, one of `take`, `dismiss`, `edit` (typed over);
  `side`, one of `this-device`, `other-device`, `none` (for `edit`).
- `sync_resolve_applied`: Apply settled the conflict. `files`, how many
  files it answered.
- `sync_resolve_cancelled`: the view closed without an answer, by "Cancel",
  the close button or Escape. No parameters.
- `sync_whole_file_answered`: "Keep this version" or "Take the other
  version" was pressed. `answer`, one of `keep-local`, `take-server`;
  `from`, one of `view`, `banner`.
- `sync_resolve_stale`: Apply was refused because a file changed since the
  view showed it. `files`, how many changed.
- `sync_resolve_apply_failed`: Apply settled nothing for another reason.
  `reason`, one of `refused` (the conflict stands with the same copies),
  `error` (the answer threw, which is also logged as an error).

#### Scenario: Resolving is measured

- **WHEN** the user opens the view on a one-hunk conflict, takes both sides
  and presses "Apply"
- **THEN** `sync_resolve_opened` with `files` 1 and `hunks` 1,
  `sync_resolve_hunk_resolved` with `how` `take` and `side` `other-device`,
  and `sync_resolve_applied` with `files` 1 are tracked, in that order

### Requirement: The view fits a phone

At phone width the view SHALL show one pane at a time, chosen with toggle
buttons named "This device", "Result" and "Other device" in a group named
"Panes", the shown pane's pressed, with the hunk controls reachable from
"Result".

#### Scenario: Resolving on a phone (manual)

- **WHEN** a user on a 390px-wide screen opens the view
- **THEN** one pane fills the screen, the buttons switch between the three, and
  a hunk can be taken from either side and applied without leaving "Result"

### Requirement: The design system shows the merge element

The design system's catalogue SHALL show the merge element with a one-line
conflict, a folded region, the ribbons, hunk controls in each state, and the
phone layout.

#### Scenario: Reviewing the element in the catalogue (manual)

- **WHEN** a reviewer opens the catalogue's Merge block
- **THEN** it shows the three panes, a fold, the ribbons and each hunk state
  in the design system's dark and light palettes, and the phone layout
