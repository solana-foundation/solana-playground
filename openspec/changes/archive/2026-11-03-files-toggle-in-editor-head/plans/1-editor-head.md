# Editor head with Files and Terminal: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 44 px editor head under the stage tabs holds the editor's tab row
and the Files and Terminal toggles; the file tree opens under it, left of the
stage, and starts closed.

**Architecture:** `BaseLayoutShell` gets a `workHead` slot drawn between
`stageTabs` and the `layout-work` group, so it spans the files column and the
stage. `LayoutShell` fills it with `BaseEditorHead`, handing it the files and
console state it already owns. The tab row stays mounted where
`EditorWithTabs` mounts it and portals into a host element the head registers
(`model/editor-head-host.ts`).

**Tech Stack:** React 19, Tailwind 4, the design system's `Button` and
`Tooltip`, lucide icons, vitest + Testing Library, Playwright.

**Spec:** `openspec/changes/files-toggle-in-editor-head/` (`design.md`,
`specs/client-v2-editor-head/spec.md`).

## Global Constraints

- Head: `#editor-head`, 44 px (`h-11`), bottom line, from 768 px only; none on a phone.
- Toggles: `#editor-head-files` (lucide `Folder`, aria-label "Files"),
  `#editor-head-terminal` (lucide `Terminal`, aria-label "Terminal");
  18 px icon (`[&_svg]:size-4.5`), 32 px button (`size-8`), 8 px radius
  (`rounded-lg`), `variant="ghost"`, `aria-pressed` = panel open, pressed
  state = hover fill (`aria-pressed:bg-accent aria-pressed:text-foreground`).
- Hints: "Files (⌘E)" and `Terminal (${keyLabel(CONSOLE_KEY, os)})`.
- `#tabs` (`PgView.ids.TABS`) keeps its id, keys, drag and menu.
- Toggles go through `setOpen(panel, { open, via: "button" })`; no telemetry event added, renamed or removed.
- `DEFAULT_LAYOUT.open.files = false`; no `LAYOUT_VERSION` bump.
- Ids, aria-labels and test ids elsewhere do not change. Conventional Commits, `feat(client-v2): …`; no AI attribution.

## Review Focus

1. A saved layout with `files: true` from before this change: the tree must open under the head on reload (Task 4 test).
2. The tab row on Build/Deploy/Interact: `Write` stays mounted, so a portaled row would linger; it must be hidden (Task 2 test).
3. The host appears after `Tabs` mounted (head renders later than the stage outlet): the row must move into the head, not stay in the stage (Task 2 test).
4. A lesson: Steps / Files switch stays at the column's top, no Hide button; head "Files" opens/closes that column (Task 3 test).
5. ⌘E and Ctrl+J move the panels and the head's `aria-pressed` follows (Task 1 `LayoutShell` test, e2e in Task 5).

---

### Task 1 (tasks.md 1.1): `BaseEditorHead`, the host store, the shell slot

**Files:**
- Create: `src/widgets/layout-shell/ui/BaseEditorHead.tsx`
- Create: `src/widgets/layout-shell/ui/BaseEditorHead.test.tsx`
- Create: `src/widgets/layout-shell/model/editor-head-host.ts` (in-source test block)
- Modify: `src/widgets/layout-shell/ui/BaseLayoutShell.tsx` (prop `workHead`, rendered after `props.stageTabs` in the `work` panel)
- Modify: `src/widgets/layout-shell/ui/LayoutShell.tsx` (renders `BaseEditorHead` into `workHead`; new prop `showTabs?: boolean`, default `true`)
- Modify: `src/widgets/layout-shell/index.ts` (export `useEditorHeadHost`)
- Test: `BaseLayoutShell.test.tsx`, `LayoutShell.test.tsx`

**Interfaces:**
- Produces:
  - `setEditorHeadHost(el: HTMLElement | null): void` and `useEditorHeadHost(): HTMLElement | null` (`useSyncExternalStore` over one module-level slot with a listener set).
  - `BaseEditorHead({ files, terminal, showTabs, hostRef, terminalKey }: { files: BarToggle; terminal: BarToggle; showTabs: boolean; hostRef: (el: HTMLElement | null) => void; terminalKey: string })`; `BarToggle` from `./BaseStageBar`.
  - `BaseLayoutShellProps.workHead: ReactNode` (not on a phone, not under Home).

- [ ] **Step 1: Failing tests**
  - `BaseEditorHead.test.tsx`: "marks each toggle pressed while its panel is open" (`files.open=true, terminal.open=false` → `#editor-head-files` `aria-pressed="true"`, `#editor-head-terminal` `"false"`); "calls each toggle's onToggle on click"; "is the 44 px head with a bottom line" (`#editor-head` has `h-11`, `border-b`); "hands the host element to hostRef, hidden when showTabs is false" (`hostRef` called with an element; that element has `hidden` iff `showTabs=false`).
  - `editor-head-host.ts` in-source: "notifies readers when the host changes" (subscribe, `setEditorHeadHost(div)` → listener called, snapshot is `div`; `setEditorHeadHost(null)` → `null`).
  - `BaseLayoutShell.test.tsx`: "draws the work head under the stage tabs from 768 px" (wide and compact: `workHead` node follows the stage tabs node in document order and precedes `#files`/`#center`); "draws no work head on a phone".
  - `LayoutShell.test.tsx`: "the head's Files and Terminal open their panels with via button" (click → `state.open.files` true, telemetry `layout_panel_toggled` `{ panel: "files", via: "button" }`; same for console); "⌘E and Ctrl+J flip the head's aria-pressed".
- [ ] **Step 2: Run** `yarn test-unit src/widgets/layout-shell` → the new cases FAIL (module/prop missing).
- [ ] **Step 3: Implement.** Head layout: `flex h-11 shrink-0 items-center gap-1 border-b border-border pr-1.5`; host `<div ref={hostRef} hidden={!showTabs} className="min-w-0 flex-1 self-stretch" />` (no display class, so `hidden` wins); toggles in a `ml-auto flex items-center gap-1` group, each wrapped in `Tooltip`. `LayoutShell` passes `files={{ open: state.open.files, onToggle: () => setOpen("files", { open: !state.open.files, via: "button" }) }}`, the console likewise, `hostRef={setEditorHeadHost}`, `terminalKey={keyLabel(CONSOLE_KEY, PgCommon.getOS())}` (as the console's own hint reads it). Under Home `workHead` is not drawn (the in-place branch never reads it).
- [ ] **Step 4: Run** `yarn test-unit src/widgets/layout-shell` → PASS.
- [ ] **Step 5: Commit** `feat(client-v2): editor head with Files and Terminal toggles (HOO-2508)`.

### Task 2 (tasks.md 1.2): the tab row in the head

**Files:**
- Modify: `src/components/Tabs/Tabs.tsx` (portal into `useEditorHeadHost()` when non-null)
- Modify: `src/views/flow/Flow.tsx` (`showTabs={state.stage === "write"}` on `LayoutShell`)
- Modify: `src/views/flow/stages/StageRouter.tsx` (drop `[&_#tabs]:pr-3` and its comment: the row no longer sits in the stage; the head's `pr-1.5` insets it)
- Create: `src/components/Tabs/Tabs.test.tsx`

**Interfaces:**
- Consumes: `useEditorHeadHost`, `setEditorHeadHost` (Task 1).

- [ ] **Step 1: Failing tests** in `Tabs.test.tsx` (mock `useExplorer`/`useWallet` to two tabs, as `Tab.test.tsx` mocks its hooks): "renders in place with no host"; "renders #tabs inside the host when one is set" (`setEditorHeadHost(hostDiv)` before render → `hostDiv.querySelector("#tabs")` not null); "moves into a host that appears after mount" (render, then `act(() => setEditorHeadHost(hostDiv))` → `#tabs` inside `hostDiv`). `afterEach(() => setEditorHeadHost(null))`.
- [ ] **Step 2: Run** `yarn test-unit src/components/Tabs/Tabs.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `const host = useEditorHeadHost(); const row = <BaseEditorTabs …/>; return host ? createPortal(row, host) : row;`. Stage switching hides it through the host's `hidden` (Task 1), no logic in `Tabs`.
- [ ] **Step 4: Run** the Tabs tests and `yarn test-unit src/widgets/layout-shell src/views/flow` → PASS.
- [ ] **Step 5: Commit** `feat(client-v2): the editor's tab row sits in the editor head (HOO-2508)`.

### Task 3 (tasks.md 1.3): drop the stage bar's toggle and the column's head

**Files:**
- Modify: `src/widgets/layout-shell/ui/BaseStageBar.tsx` (remove `files` prop and `FilesToggle`; keep `BarToggle` export and `FolderClosed` import only if still used)
- Modify: `src/widgets/layout-shell/ui/LayoutShell.tsx` (stop passing `files` to both `BaseStageBar`s)
- Modify: `src/views/flow/left/LeftPanel.tsx` (remove `onHide`, `HideButton`, the non-lesson head; the lesson's Segmented row stays)
- Modify: `src/views/flow/Flow.tsx` (no `onHide` on either `LeftPanel`)
- Test: `BaseStageBar.test.tsx`, `LeftPanel.test.tsx`, `LayoutShell.test.tsx`

- [ ] **Step 1: Update tests first**
  - `BaseStageBar.test.tsx`: delete "names the files toggle by what it does" and "labels the files toggle 'Files' in text…"; rename "draws no files toggle where it is not handed…" to "draws no files toggle, and always the documentation" asserting no "Expand project panel"/"Collapse project panel".
  - `LeftPanel.test.tsx`: replace the Hide files cases with "has no head outside a lesson" (no "Hide files" button, no "Files" heading text) and "keeps the Steps / Files switch in a lesson, with no Hide button".
  - `LayoutShell.test.tsx`: every "Expand/Collapse project panel" lookup becomes `#editor-head-files` with `aria-pressed`; the case near the phone Sheet comment keeps its meaning (no Hide files there).
- [ ] **Step 2: Run** `yarn test-unit src/widgets/layout-shell src/views/flow/left` → FAIL on the removed controls still present.
- [ ] **Step 3: Implement** the removals; update `LeftPanel`'s `collapsed` JSDoc to "Hidden by the editor head's Files or ⌘E".
- [ ] **Step 4: Run** the same command → PASS; `yarn test-types` → clean.
- [ ] **Step 5: Commit** `feat(client-v2): the files toggle leaves the stage bar and the column's head (HOO-2508)`.

### Task 4 (tasks.md 1.4): the tree starts closed

**Files:**
- Modify: `src/widgets/layout-shell/model/layout-state.ts` (`DEFAULT_LAYOUT.open.files: false`)
- Test: `src/widgets/layout-shell/model/use-layout-state.test.ts` (and `layout-state.ts`'s in-source block if it pins the default)

- [ ] **Step 1: Failing tests:** "a first visit opens with the files column closed" (`localStorage` empty → `state.open.files === false`); "a saved open files column stays open" (store `{ v: LAYOUT_VERSION, open: { nav: true, files: true, assistant: true, console: false } }` → `true`).
- [ ] **Step 2: Run** `yarn test-unit src/widgets/layout-shell/model` → the first FAILS.
- [ ] **Step 3: Implement** the one-value change; fix any shell test that relied on the open default by seeding the layout explicitly.
- [ ] **Step 4: Run** `yarn test-unit src/widgets src/views` → PASS.
- [ ] **Step 5: Commit** `feat(client-v2): the file tree starts closed on a first visit (HOO-2508)`.

### Task 5 (tasks.md 1.5): e2e

**Files:**
- Create: `e2e/client-v2-editor-head.e2e.spec.ts` (one test per spec scenario, titled `client-v2-editor-head: <scenario name>`; "File actions from the tree" included)
- Modify: `e2e/fixtures.ts` (`openFiles(page)`: clicks `#editor-head-files` when its `aria-pressed` is `"false"`, waits for `#files`)
- Modify: `e2e/left-panel-toggle.e2e.spec.ts`, `e2e/client-v2-layout.e2e.spec.ts`, `e2e/files.e2e.spec.ts` (head's "Files" instead of "Expand/Collapse project panel" / "Hide files")
- Modify: every spec that clicks the tree on a first visit, found by running them (step 2)

- [ ] **Step 1: Write** the new spec and the fixture helper; switch the three named specs to the head.
- [ ] **Step 2: Run** `yarn test-e2e e2e/client-v2-editor-head.e2e.spec.ts e2e/left-panel-toggle.e2e.spec.ts e2e/client-v2-layout.e2e.spec.ts e2e/files.e2e.spec.ts`, then the specs that touch the tree (`grep -l` for tree file clicks / "New file" in `e2e/`); add `openFiles(page)` where a first visit now finds the tree closed.
- [ ] **Step 3: Run** the same set → all PASS; `yarn spec:coverage` lists no `client-v2-editor-head` scenario.
- [ ] **Step 4: Commit** `test(client-v2): editor head scenarios; specs open the tree from the head (HOO-2508)`.

### Task 6 (tasks.md 1.6): screenshots and hand-off

- [ ] **Step 1:** After screenshots at 1440 (tree closed, tree open, lesson), beside the before set in `.claude/lead/screenshots/hoo-2508/`; compare with DES-205's Before/After.
- [ ] **Step 2:** `yarn run check`; tick 1.1–1.6 in `tasks.md`.
- [ ] **Step 3:** INTAKE to Lead: the superseded `ui-migration` sentences (design.md, Context).
