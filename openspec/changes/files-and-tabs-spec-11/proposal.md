# Proposal

## Why

The Write stage's files and tabs still speak the classic product next to the
redesigned shell, and two of their failures are silent: a refused autosave
write goes to the developer console, and a refused drag-and-drop move does
nothing at all. The designers' Spec 11, "Projects and files", and the Design
alignment audit of 28 Oct (items A7 to A10, HOO-2388) set what these parts say
and do; Breakpoint needs them before stage 1 closes.

## What Changes

- With no tab open, the editor shows "No file open" and a "Show files" button
  that opens the Files column (the Files page on a phone), in place of the
  classic Resources and Tutorials home.
- The editor tab's menu reads in sentence case: Close, Close others, Close to
  the right, Close all.
- The project delete dialog says "Delete {name}?", what goes, a lesson line and
  a signed-in line where they apply, with "Delete project" and Cancel focused.
  The file and folder delete dialog names the item and counts a folder's files.
- A lesson's row in the project list shows the tutorial glyph; the list shows
  three skeleton rows while the project names load.
- The Files column foot offers New file and New folder. The tree's menu reads
  in sentence case and adds "Move to…", a folder picker that works by keyboard
  and touch. `src` shows Rename, Move to… and Delete disabled with the reason.
- The command decides file or folder; a dot in the name no longer does.
- A name typed for a new or renamed file or folder follows Spec 11's rule, and a
  refused name shows its reason under the field. Files already stored under an
  older, looser rule still load.
- The tree carries the WAI-ARIA tree roles: `tree`, `treeitem`, `group`,
  `aria-expanded` and `aria-level`.
- A refused move, by drag or by Move to…, shows its reason. A refused autosave
  write shows a "not saved" marker on the tab and the FILE-01 callout above the
  editor; the next accepted write clears both. An edit still waiting for its
  autosave is written on `pagehide`.
- Telemetry: no events are added, renamed or removed. `widgets/app-nav` gains
  no user action. Spec 11's file events (`file_created`, `file_moved`,
  `file_action_failed`, `save_failed`, `storage_notice_shown`) are left to the
  telemetry naming work (HOO-1799, HOO-2078); the touched explorer and editor
  are legacy roots with no tracker.

## Capabilities

### New Capabilities

- `client-v2-files`: the Write stage's file tree, editor tabs, empty editor,
  autosave failure surface, and the project and item delete dialogs.

### Modified Capabilities

None.

## Impact

- Code: `components/Editor` (empty state, autosave), `components/Tabs`,
  `views/sidebar/explorer` (tree, menu, create, move, delete, the
  drag-and-drop move), `views/flow/left/LeftPanel.tsx` (foot),
  `widgets/app-nav` (lesson glyph, skeleton), `widgets/layout-shell` (a way for
  the editor to open Files), `utils/explorer/explorer.ts` (item type, name
  rule).
- Branches: the autosave task lands on `scope/users-work`, where autosave
  already moved into `components/Editor/Monaco/autosave.ts` (#179, #196); the
  other tasks land on `scope/interface`.
- Out of scope: arrow-key navigation inside the tree, undo for a delete, files
  at the project root, the 64-file and path-length build warnings, the
  second-tab callouts, the read-only editor below 600 px, Spec 11's analytics
  events, the project list's order and sync markers (HOO-2389, Spec 02).
