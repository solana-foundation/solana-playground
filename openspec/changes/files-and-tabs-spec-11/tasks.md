# Tasks

Three PRs, one per group, all HOO-2388. Groups 1 and 3 can run at the same
time; group 2 starts after group 1 merges, because both change
`views/sidebar/explorer` and `views/flow/left`.

## 1. Empty editor, tab menu, delete dialogs, project rows (`scope/interface`)

- [x] 1.1 ([plan](plans/1-empty-editor-tabs-dialogs-rows.md)) `PgView.showFiles()` and `onDidRequestFiles`; `LayoutShell` opens the Files column (desktop) or the Files page (phone) on it; verify with a `LayoutShell.test.tsx` case for each width
- [x] 1.2 `BaseNoFileOpen` / `NoFileOpen` in `widgets/layout-shell`, rendered by `Editor.tsx` in place of `Editor/Home`, which is deleted; verify with a Base test and the e2e scenario "client-v2-files: Closing the last tab"
- [x] 1.3 Tab menu in sentence case, key hint "Alt+W"; verify with the updated `Tab.test.tsx` list
- [x] 1.4 `ModalFrame` `openFocus: "cancel"`; `DeleteWorkspace` and `DeleteItem` copy, lesson line, signed-in line and folder file count per the spec; verify with tests for each line's presence and Cancel's focus
- [x] 1.5 Lesson rows show the tutorial glyph and the list shows three skeleton rows before the names are read; verify with `BaseProjectList.test.tsx` and `ProjectList.test.tsx` cases
- [x] 1.6 Before/after screenshots, desktop and phone, of the empty editor, the tab menu, both delete dialogs and the project list

## 2. File tree (`scope/interface`, after group 1)

- [ ] 2.1 Item type from state (`getItemTypeFromPath`, `getFolderContent`, the IndexedDB loader, `renameItem`) and `createItem({ type })`; verify with `explorer.test.ts` cases for "Makefile" as a file, "v1.2" as a folder across a reload, and a dotted import unchanged
- [ ] 2.2 `PgExplorer.checkItemName` with Spec 11's reasons; the create and rename fields show the reason under the field; verify with unit cases per reason and the e2e scenario "client-v2-files: A name with a space"
- [ ] 2.3 Files column foot with New file and New folder; tree menu in sentence case with New file and New folder on every row and `src`'s items disabled with the reason; verify with `LeftPanel.test.tsx` and `ExplorerContextMenu.test.tsx`
- [ ] 2.4 One `moveItem` path for drag and Move to…: replace question on a taken name, a toast with the reason for any other refusal; verify with a test that a rejected rename toasts and leaves the tree
- [ ] 2.5 Move to… dialog on the design system's `Command`; verify with the e2e scenario "client-v2-files: Move by keyboard"
- [ ] 2.6 Tree roles: `tree`, `treeitem`, `group`, `aria-level`, `aria-expanded` kept in step with the `OPEN` class; verify with a test that opens a folder and reads the attributes
- [ ] 2.7 `createWorkspace` is undone when a file write or the switch fails: the half-made workspace leaves the name list and storage, and the caller (New project, the phone quick start) shows the failure; intake of 29 Oct from the HOO-2391 review; verify with an `explorer.test.ts` case whose write rejects
- [ ] 2.8 Before/after screenshots, desktop and phone, of the foot, the menu, a refused name and Move to…

## 3. Refused autosave writes (`scope/users-work`)

- [ ] 3.1 Per-file save-failure store fed by the autosave `save` catch and cleared by the next accepted write; verify with in-source tests
- [ ] 3.2 Not-saved marker on the tab and the FILE-01 callout above the editor with Export project; verify with Base tests and a manual check with site data blocked
- [ ] 3.3 `pagehide` flushes the pending autosave; verify with the e2e scenario "client-v2-files: Reload inside the delay"
