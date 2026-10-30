# Group 1: empty editor, tab menu, delete dialogs, project rows

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec 11's empty editor, sentence-case tab menu, delete dialog copy, lesson glyph and list skeleton, on `scope/interface`.

**Architecture:** `PgView` carries a "show files" request from the editor to `LayoutShell`. The empty editor is a Base pair in `widgets/layout-shell`. Delete dialogs keep `ModalFrame`, which gains Cancel-first focus.

**Tech Stack:** React 19, Tailwind 4, the design system in `shared/ui`, vitest + Testing Library, Playwright.

**Spec:** `openspec/changes/files-and-tabs-spec-11/specs/client-v2-files/spec.md`, `design.md`.

## Global Constraints

- Copy is exact: "No file open", "Show files", "Close", "Close others", "Close to the right", "Close all", "Alt+W", "Delete {name}?", "Its files and its program keypair are deleted from this browser.", "Your progress in this lesson is lost.", "It's also deleted from your account and your other devices.", "Delete project", "Cancel", "Delete {name} and the {n} files in it?", "the 1 file", "You can't undo this.", "Delete".
- No telemetry event added; "Show files" sends `layout_panel_toggled` `{ panel: "files", open: true, via: "button" }` through the existing path.
- Ids, aria-labels and test ids that exist stay: `Actions for {name}`, `Delete {name}`, `Close {name}`, modal names `delete-workspace`, `delete-item`.

## Review Focus

- "Show files" while Files is already open: nothing toggles closed (open is set, never flipped). Test in Task 1.
- "Show files" under Home or a page cover: the shell ignores it, as Ctrl+E does. Test in Task 1.
- A phone's delete dialog has no Cancel: `openFocus: "cancel"` falls back to the dialog, never the destructive submit. Test in Task 4.
- A folder holding only empty sub-folders: count 0, title "Delete {name}?". Test in Task 4.
- The session not read yet when the dialog opens: no signed-in line, and it appears once read (re-render on `PgSession.onDidChange`). Test in Task 4.

---

### Task 1: The "show files" request

**Files:** Modify `src/utils/view.ts` (events, two statics), `src/widgets/layout-shell/ui/LayoutShell.tsx` (subscription); Test `src/widgets/layout-shell/ui/LayoutShell.test.tsx`.

**Interfaces:** Produces `PgView.showFiles(): void` and `PgView.onDidRequestFiles(cb: () => void): Disposable`, event name `PgView.events.FILES_REQUEST = "viewfilesrequest"`.

- [ ] Step 1: tests "opens the Files column on a show-files request", "leaves an open Files column open", "opens the phone's Files page on a show-files request", "ignores a show-files request under Home". Each calls `act(() => PgView.showFiles())` and reads the column/Sheet as the existing Ctrl+E tests do.
- [ ] Step 2: run `yarn test-unit src/widgets/layout-shell/ui/LayoutShell.test.tsx`; the four fail.
- [ ] Step 3: implement both statics with `PgCommon.createAndDispatchCustomEvent` / `PgCommon.onDidChange`; in `LayoutShell` an effect subscribes: covered → return; phone → `setPhoneFiles(true, "button")`; else `setOpen("files", { open: true, via: "button" })`.
- [ ] Step 4: run the file; all pass.
- [ ] Step 5: commit `feat(client-v2): let the editor ask the shell to show Files (HOO-2388)`.

### Task 2: "No file open"

**Files:** Create `src/widgets/layout-shell/ui/BaseNoFileOpen.tsx`, `NoFileOpen.tsx`, `BaseNoFileOpen.test.tsx`; export `NoFileOpen` from `src/widgets/layout-shell/index.ts`; modify `src/components/Editor/Editor.tsx`; delete `src/components/Editor/Home/` and the `#home` rule in `Editor.tsx`; add `e2e/files.e2e.spec.ts`.

**Interfaces:** Consumes Task 1. Produces `BaseNoFileOpen({ onShowFiles }: { onShowFiles: () => void })`, `NoFileOpen()`.

- [ ] Step 1: Base test: renders heading "No file open"; button "Show files" calls `onShowFiles`. E2E "client-v2-files: Closing the last tab": open a project, close every tab, expect heading "No file open", no "Resources"/"Tutorials" heading; fold Files with its hide button, press "Show files", expect the Files column visible (scenario "Show files with the column folded" in the same spec file).
- [ ] Step 2: run the unit test; fails (no module).
- [ ] Step 3: `BaseNoFileOpen` from `@/shared/ui/empty` (`Empty`, `EmptyHeader`, `EmptyMedia variant="icon"` with lucide `FileCode`, `EmptyTitle`, `EmptyContent` with `Button variant="outline"`). `NoFileOpen` passes `PgView.showFiles`. `Editor.tsx` renders `<NoFileOpen />` where it rendered `<Home />`.
- [ ] Step 4: unit test passes; `yarn test-types` clean; `yarn test-e2e e2e/files.e2e.spec.ts` passes.
- [ ] Step 5: commit `feat(client-v2): the editor with no file open offers Files (HOO-2388)`.

### Task 3: Tab menu

**Files:** Modify `src/components/Tabs/Tab.tsx`, `src/components/Tabs/Tab.test.tsx`.

- [ ] Step 1: update the test names and the exact list to `["CloseAlt+W", "Close others", "Close to the right", "Close all"]`.
- [ ] Step 2: run `yarn test-unit src/components/Tabs/Tab.test.tsx`; fails.
- [ ] Step 3: change the four labels and the shortcut text.
- [ ] Step 4: passes.
- [ ] Step 5: commit `fix(client-v2): the tab menu reads in sentence case (HOO-2388)`.

### Task 4: Delete dialogs

**Files:** Modify `src/widgets/overlays/ui/BaseModalFrame.tsx` (`OpenFocus` gains `"cancel"`), its test; `src/views/sidebar/explorer/Component/Modals/DeleteWorkspace.tsx`, `DeleteItem.tsx`; Test `Modals/DeleteWorkspace.test.tsx`, `Modals/DeleteItem.test.tsx`.

**Interfaces:** Produces `OpenFocus = "field" | "dialog" | "cancel"`; `"cancel"` focuses the Cancel button, or the dialog when there is none (phone).

- [ ] Step 1: BaseModalFrame tests "focuses Cancel on open" and "focuses the dialog when cancel has no button on a phone". DeleteWorkspace tests: signed out scratch shows title "Delete counter?", the files line, no lesson line, no account line, button "Delete project"; `isLesson` adds the lesson line; a session (`PgSession` mocked through `vi.mock("@/features/auth")`) adds the account line; Cancel has focus. DeleteItem tests: file "Delete lib.rs?"; folder with two files at any depth "Delete utils and the 2 files in it?"; one file "the 1 file"; empty folder "Delete utils?"; body "You can't undo this."; Cancel has focus.
- [ ] Step 2: run the three test files; they fail.
- [ ] Step 3: implement. Bodies are plain `<p>` lines with Tailwind text classes (`text-body`, `text-muted-foreground` for secondary lines); the `Warning` icon and styled-components go. File count: entries of `PgExplorer.files` under `appendSlash(path)` whose `content` is defined. Signed in: `PgSession.get() !== null`, re-render with `useRenderOnChange(PgSession.onDidChange)`.
- [ ] Step 4: pass; `e2e/home.e2e.spec.ts` and `e2e/two-tabs.e2e.spec.ts` match the button by `/^delete/i` and exact "Delete": update the two project-delete lookups to "Delete project".
- [ ] Step 5: commit `feat(client-v2): delete dialogs name what goes (HOO-2388)`.

### Task 5: Lesson glyph and skeleton

**Files:** Modify `src/widgets/app-nav/ui/BaseProjectList.tsx`, `ProjectList.tsx`, their tests.

**Interfaces:** `BaseProjectListProps.loading: boolean` (true draws three `SidebarMenuSkeleton showIcon` rows and no entry).

- [ ] Step 1: tests: a lesson entry's row holds `data-glyph="lesson"`, a project's `data-glyph="project"` (the glyph svg gets the attribute); `loading` renders three `[data-sidebar="menu-skeleton"]` and no row; `ProjectList` passes `loading` while `PgExplorer.allWorkspaceNames` is undefined.
- [ ] Step 2: run; fails.
- [ ] Step 3: `GraduationCap` for `entry.isLesson`, `Folder` otherwise.
- [ ] Step 4: passes.
- [ ] Step 5: commit `feat(client-v2): lesson rows and the loading list follow Spec 11 (HOO-2388)`.

### Task 6: Screenshots and gate

- [ ] Before (`origin/scope/interface`) and after, at 1440x900 and 390x844, through Playwright: empty editor, tab menu, project delete dialog, folder delete dialog, project list with a lesson. Saved to the scratchpad, uploaded to the PR.
- [ ] `yarn run check` green; tick 1.1-1.6 in `tasks.md`.
