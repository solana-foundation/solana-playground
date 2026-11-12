# Projects single bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project shows one bar over its code, the tutorial's dock behaviour for its tree, and its name in the chat head (HOO-2827).

**Architecture:** `BaseEditorHead` absorbs the stage bar's Share, ⋯ and (only while hidden) the assistant toggle; `LayoutShell` stops passing a stage bar for a project. The tree's dock state is `layout.open.files`; an undocked tree opens in a Popover anchored to the head. The pin/unpin move to a shared `tree-dock.tsx` both trees use.

**Tech Stack:** React, Radix Popover (shared/ui), vitest + Testing Library, Playwright.

**Spec:** `openspec/changes/projects-single-bar/` (proposal, design, specs).

## Global Constraints

- Keep ids and names: `#editor-head`, `#editor-head-files`, `#editor-head-terminal`, "Expand assistant", "Collapse assistant", "More options", "Documentation", "Dock beside the editor", "Undock the files".
- Pin threshold: code area > `DOCK_MIN_PX` (1100) px, the tutorial's constant, imported, not copied.
- Telemetry: `layout_files_dropdown_opened { via: "button" | "key" }`; `layout_panel_toggled` files `open` = docked.
- No keyboard binding changes (parallel hotkeys session).
- Node 22 by explicit PATH; commands from `client-v2/`.

## Review Focus

- The Explorer's context menu / rename dialog inside the Popover must not close it (portal clicks are "outside") — e2e "File actions from the tree".
- Window narrowed below 1100 with the tree docked: no column, Files opens the dropdown; widened again: column back — unit test in 3.2.
- Under Home the assistant toggle and bar stay as before — LayoutShell test "draws the column bar over Home".
- Below 1024 px (assistant as Sheet): "Expand assistant" in the head while the Sheet is closed — LayoutShell test.
- Rename of the open project updates the chat head — Assistant test.

---

### Task 1: One row

**Files:** Modify `src/widgets/layout-shell/ui/BaseStageBar.tsx` (export `AssistantToggle`, `MoreOptions`), `BaseEditorHead.tsx`, `LayoutShell.tsx`, `BaseLayoutShell.tsx`; tests `BaseEditorHead.test.tsx`, `LayoutShell.test.tsx`, `BaseLayoutShell.test.tsx`, `BaseStageBar.test.tsx`.

**Interfaces — Produces:** `BaseEditorHeadProps` gains `actions?: ReactNode`, `assistant: BarToggle | null` (drawn only when `!assistant.open`), `assistantKey?: string | null`; always draws `MoreOptions`. `files.open` stays "tree shown".

- [ ] Test: BaseEditorHead renders buttons in order Files, Terminal, actions, "More options"; no "Expand assistant" when `assistant.open`; "Expand assistant" calling `onToggle` when closed.
- [ ] Implement; run `yarn vitest run src/widgets/layout-shell` → PASS after updating LayoutShell tests: project work column has no `[data-slot="stage-bar"]`; Home keeps it; "Expand assistant" in `#editor-head` after "Collapse assistant".
- [ ] Commit `feat(client-v2): one bar over a project's code (HOO-2827)`.

### Task 2: The chat head names the project

**Files:** `src/widgets/assistant/model/head-label.ts`, `ui/Assistant.tsx`, tests in-source + `Assistant.test.tsx`, `BaseAssistantHead.test.tsx`.

**Interfaces:** `headLabel(project: string | null): HeadLabel` → `{kind:"plain", text: project ?? "Assistant"}`; the `model` kind and `KEY_OWNER` stay only if other callers use them.

- [ ] Tests: "anchor-project" with a hosted model → head "anchor-project"; null → "Assistant"; rename updates it.
- [ ] Implement, run `yarn vitest run src/widgets/assistant` → PASS. Commit.

### Task 3: The tree docks like the tutorial's

**Files:** Create `src/widgets/tutorial-workspace/ui/tree-dock.tsx` (`DockPin({onDock})`, `UndockPin({onUndock})`, `TREE_SHEET` class); modify `BaseWorkspaceHead.tsx`, `BaseDockedTree.tsx`, `widgets/tutorial-workspace/index.ts` (export them and `DOCK_MIN_PX`); `layout-shell/model/layout-state.ts` (default `files: true`), `telemetry.ts` (new event), `LayoutShell.tsx`, `BaseLayoutShell.tsx` (column top-right `UndockPin`; Popover anchored under the head holding `files` slot content with `DockPin` when wide).

**Interfaces:** `BaseLayoutShell` gets `filesDropdown: {open, canDock, onClose, onDock, onUndock}`; LayoutShell owns `dropdownOpen` state, `wide` (ResizeObserver on the work column ≥ 1100), `toggleFiles(via)`: docked && wide → `setOpen("files", false)`; else toggle dropdown and track `layout_files_dropdown_opened` on open.

- [ ] Tests (LayoutShell): first visit → docked, Files pressed; Files → column gone, unpressed; Files → dropdown (role dialog "Files") with "Dock beside the editor"; pin → column back, dropdown gone; event sent with `via:"button"` via the memory provider; width 1000 → no pin, docked shows as dropdown.
- [ ] Tutorial tests stay green (`yarn vitest run src/widgets/tutorial-workspace`).
- [ ] Commit.

### Task 4: e2e and docs

- [ ] Update e2e specs listed in the proposal's Impact (stage bar → head, "Hide the assistant" → "Collapse assistant", first visit docked, head text project name); add "File actions from the tree" through the dropdown.
- [ ] `docs/upstream-divergences.md`, `docs/assistant-context.md` (then `yarn sync-assistant-context`).
- [ ] `yarn run check` → green. Commit.
