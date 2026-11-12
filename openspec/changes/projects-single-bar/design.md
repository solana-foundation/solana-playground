# Design

## Context

`LayoutShell` builds the work column from `stageBar` (BaseStageBar), the
stage tabs and `workHead` (BaseEditorHead); `BaseLayoutShell` stacks them
over the files ResizablePanel and the stage. Files open/closed is
`layout.open.files` in the saved layout (`layout` key), default closed. The
tutorial workspace has its own head with a popover tree, a pin («Dock
beside the editor», shown while the workspace is ≥ `DOCK_MIN_PX` = 1100 px)
and a fixed 220 px docked tree with an unpin. The project tree is the
upstream Explorer in `LeftPanel`: nested folders, context menu, inline
create and rename, drag-and-drop, "+ New file".

## Goals / Non-Goals

**Goals:** one row over a project's code; the tutorial's dock behaviour and
look for the project tree; the project's name in the chat head; the chat's
reopen in the row only while it is hidden.

**Non-Goals:** porting the Explorer's editing into the tutorial's flat tree
list; changing the stage tabs; keyboard handling; the phone.

## Decisions

1. **"One component" is the shell, not the list.** The pin, the unpin and
   the dropdown's sheet styling move out of `BaseWorkspaceHead` /
   `BaseDockedTree` into one shared piece (`shared/lib/tree-dock.tsx`:
   `DockPin`, `UndockPin`, `TREE_SHEET`, `DOCK_MIN_PX`; in `shared/lib`
   since a widget may not import another widget's internals), used by both
   trees. The project tree keeps the Explorer body. Mapping PgExplorer into
   `TreeRow` would drop create, rename, delete, move and nested folders,
   which the tutorial list has no use for. Alternative rejected: one list
   component for both (days of work, loses editing).
2. **Docked = the files column.** `layout.open.files` now means docked; the
   column keeps its resizable width (240 px default) rather than the
   tutorial's fixed 220 px, since project trees run deeper. Default for a
   layout with nothing saved becomes docked. A saved layout keeps its value,
   so people who closed the column see the dropdown.
3. **The dropdown is a Popover anchored to the row**, holding the same
   `LeftPanel` (the Explorer mounts once: in the column while docked and
   shown, else in the dropdown while it is open). Clicks inside the
   Explorer's portalled context menu and dialogs do not count as outside.
4. **Width gate** (Lead, 12 Nov). The code area (the work column's stage width including a
   docked tree) is measured with a ResizeObserver; below 1100 px the pin
   hides and a docked tree shows as the dropdown, as in the tutorial.
   Narrower, the dropdown shows no pin. Files while docked and shown
   undocks; otherwise it toggles the dropdown. An unpinned tree stays a
   dropdown until pinned again.
5. **The row.** `BaseEditorHead` gains `actions` (Share), an `assistant`
   toggle drawn only while the assistant is hidden ("Expand assistant",
   same name as before so the e2e path holds), and ⋯ ("More options" with
   Solana documentation). The stage bar stays for Home and covers only.
6. **Head label.** As Almaz's commit does it: the project name as a plain
   label when a project is open, else the model label as before.

## Risks / Trade-offs

- Existing users with `files: false` saved see the dropdown, not the docked
  default. Accepted: their choice is the remembered one.
- The Explorer inside a Popover: inline rename inputs and the context menu
  must keep focus; covered by an e2e case.
- ⌘E is the parallel hotkeys session's; it keeps calling the same toggle.
