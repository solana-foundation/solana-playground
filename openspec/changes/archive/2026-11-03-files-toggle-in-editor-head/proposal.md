# Proposal

## Why

The frame spends a whole column, with its own "Files" head and a toggle in
the stage bar, on the file tree of the one open project, even when the
project holds two files. DES-205 (Almaz, approved by Slava on 2 Nov; Slava
chose it over the ticket's earlier "the project row expands into its tree"
wording on 3 Nov) takes the tree out of the layout until it is wanted:
HOO-2508.

## What Changes

- A 44 px editor head runs across the files column and the stage, under the
  stage tabs. On its left are the editor's tabs (on the Write stage); on its
  right the wallet button, then two icon toggles: Files (a folder) and
  Terminal (`>_`).
- Files opens the file tree as a column left of the stage, under the head,
  and a second click closes it. The head does not move when the tree opens:
  the stage gives up the width.
- Terminal opens and closes the console under the stage. The console keeps
  its own bar.
- The tree starts closed on a first visit. A saved layout keeps what it
  says, so a visitor who had the tree open keeps it open.
- **BREAKING** (for anyone driving the UI by name): the stage bar loses
  "Collapse project panel" / "Expand project panel", and the files column
  loses its own head ("Files" and "Hide files"). In a lesson the column's
  Steps / Files switch stays, without the Hide button. ⌘E and the empty
  editor's "Show files" still open the tree.
- The editor tab row moves out of the stage into the head; it keeps its id
  (`tabs`), its keys, drag to reorder and menu.
- Telemetry: no events are added, renamed or removed. The head's toggles
  send `layout_panel_toggled` with `via: "button"`, as the stage bar's
  toggle did.

## Capabilities

### New Capabilities

- `client-v2-editor-head`: the bar over the files column and the stage that
  holds the editor's tabs and the Files and Terminal toggles, and where the
  file tree opens.

### Modified Capabilities

None in `openspec/specs/`. The frame's requirements live in the open
`ui-migration` change (`specs/client-v2-layout`), whose sentences about the
stage bar's "Collapse/Expand project panel" and a files column open on a
first visit this change supersedes; `design.md` lists them.

## Impact

- Code: `widgets/layout-shell` (a head slot in the work area, the stage
  bar's files toggle removed, the first-visit default), `views/flow/Flow.tsx`
  (composes the head), `views/flow/left/LeftPanel.tsx` (its head removed),
  `components/Tabs` (renders into the head on a wide or tablet window), e2e
  specs that click "Expand project panel" or "Hide files".
- Users: the code gets the width by default; the tree is one click away in
  the head, where the terminal's toggle also sits.
- Out of scope: the phone layout (its Files page is unchanged), the file
  operations themselves (`files-and-tabs-spec-11` group 2), tutorial flow
  v2's tree popover (one pattern for both is the designers' call), and
  remembering open or closed per project.
