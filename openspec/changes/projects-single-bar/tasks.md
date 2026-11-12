# Tasks

All tasks: HOO-2827, one PR. Order: 1 and 2 run in any order; 3 needs 1;
4 needs 1–3.

## 1. One row (plan: [plans/1-one-row.md](plans/1-one-row.md))

- [ ] 1.1 `BaseEditorHead` takes `actions`, `assistant` (drawn only while hidden, "Expand assistant") and the ⋯ "More options" menu with "Solana documentation"; unit tests
- [ ] 1.2 `LayoutShell` / `BaseLayoutShell` draw no stage bar over a project's work column; Home and covers keep `BaseStageBar`; Flow's Share goes to the head; unit tests updated

## 2. The chat head names the project (plan: [plans/1-one-row.md](plans/1-one-row.md), Task 2)

- [ ] 2.1 `headLabel` takes the project name ("Assistant" without one); the model part leaves the head; `Assistant` passes `useProjectName()`; unit tests

## 3. The tree docks like the tutorial's (plan: [plans/1-one-row.md](plans/1-one-row.md), Task 3)

- [ ] 3.1 Pull the pin, the unpin and the sheet style into `tutorial-workspace/ui/tree-dock.tsx`; the tutorial head and docked tree use it (no visible change)
- [ ] 3.2 Projects: docked = `layout.open.files`, default docked; the column gets "Undock the files"; "Files" undocks or toggles a dropdown holding `LeftPanel` with «Dock beside the editor» while the code area is > 1100 px; `layout_files_dropdown_opened`; unit tests through the memory provider

## 4. Tests and docs (plan: [plans/1-one-row.md](plans/1-one-row.md), Task 4)

- [ ] 4.1 Update the e2e specs that assert the stage bar, "Hide the assistant", the closed-by-default tree and the "Assistant" head; add the dropdown's file actions case
- [ ] 4.2 `docs/upstream-divergences.md` and `docs/assistant-context.md` where they describe the bar or the Files column
