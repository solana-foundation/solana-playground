# The About page as the stand draws it — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A tutorial's About page reads like Almaz's stand: title-case action,
level tag plus framework and languages as icon and text, the assistant named
after the tutorial, and an empty files column while it is not started.

**Architecture:** `entities/tutorial` gains one model hook,
`useTutorialBeforeStart`, that names the tutorial on screen while it is not
started; the assistant's head and the files column read it. The start
button's labels and the detail tags change in place in `entities/tutorial`.

**Tech Stack:** React 19, Tailwind 4, vitest + Testing Library, Playwright.

**Spec:** `openspec/changes/tutorials-gallery-stand/specs/client-v2-tutorials/spec.md`,
requirements "The About page introduces the tutorial" and "Beside the About
page, the assistant names the tutorial and the files column is empty".

## Global Constraints

- Labels exactly `Start`, `Continue`, `Completed`.
- Level stays the DS `Tag` with `levelVariant` (upper case, `BEGINNER` green).
- Framework and languages: icon + title-case name, `font-act`, muted text, in
  a soft box (`rounded-md bg-surface-raised px-3 py-2`), no `Tag`, no
  upper case. Stand: `client/src/components/Tag/Tag.tsx` `Boxed`.
- Ids, aria-labels and test ids unchanged; no edit in `src/shared/ui`.
- The lesson view (`views/flow/lessons`) is untouched.

## Review Focus

- Cold load straight onto `/tutorials/hello-anchor` before the explorer is
  initialised: `PgTutorial.isStarted` throws then; the hook must read `null`
  until `allWorkspaceNames` exists, not crash the assistant.
- A user with other projects opens an unstarted tutorial's About page: the
  files column is empty (the stand's picture) and the head keeps the open
  project's name, whose thread and tools are still in play (review,
  2026-10-26).
- Pressing Start: the head and files follow the new workspace without a
  reload (the hook listens to `PgExplorer.onDidSwitchWorkspace`).
- Leaving the tutorial route: `PgTutorial.current` turns null and the head
  returns to the project name (`PgTutorial.onDidChangeCurrent`).
- A started tutorial's About page shows its own workspace as before.

---

### Task 1: Start button and details (R55, R74)

**Files:**
- Modify: `client-v2/src/entities/tutorial/ui/BaseStartButton.tsx` (labels, JSDoc)
- Modify: `client-v2/src/entities/tutorial/ui/BaseStartButton.test.tsx`
- Modify: `client-v2/src/entities/tutorial/ui/BaseDetailTag.tsx` (non-level kinds render a soft box, not `Tag`)
- Modify: `client-v2/src/entities/tutorial/ui/BaseDetailTag.test.tsx`, `DetailTag.test.tsx`
- Modify: e2e specs finding `START`: catalog, account-sync, project-list, home,
  workspace-migration, lessons, client-v2-layout, no-document-scroll,
  lesson-path, thread-restore (selector and comments → `Start`)

- [ ] **Step 1: Failing tests.** `BaseStartButton.test.tsx` table becomes
  `["new","Start"],["started","Continue"],["completed","Completed"]`.
  `BaseDetailTag.test.tsx`: the framework case asserts the box has
  `data-slot="detail"` (not a `Tag`), the icon is its first child, and the
  text is `Anchor`; the plain-kind case asserts `data-slot="detail"` and no
  children elements. `DetailTag.test.tsx` `tagOf` finds `[data-slot]` as now.
- [ ] **Step 2:** `yarn test-unit src/entities/tutorial` → the new cases FAIL.
- [ ] **Step 3:** Labels to title case; JSDoc drops the "upper case because
  e2e" sentence. `BaseDetailTag` non-level branch: `<span data-slot="detail"
  className={cn("inline-flex items-center gap-2 rounded-md
  bg-surface-raised px-3 py-2 font-act text-control text-muted-foreground
  [&>img]:size-4 [&>svg]:size-4", className)}>`; the round-icon class from
  `DetailTag` keeps working.
- [ ] **Step 4:** `yarn test-unit src/entities/tutorial` → PASS.
- [ ] **Step 5:** e2e selectors `name: "START"` → `name: "Start"` (keep
  `exact: true`); comments that say START say Start. `grep -rn '"START"' e2e`
  → nothing.
- [ ] **Step 6:** Commit `fix(client-v2): the About page's action and details as the stand draws them (HOO-2254)`.

### Task 2: The assistant and the files column beside an unstarted tutorial (R53, R54)

**Files:**
- Create: `client-v2/src/entities/tutorial/model/use-tutorial-before-start.ts` (+ export from `index.ts`)
- Create: `client-v2/src/entities/tutorial/model/use-tutorial-before-start.test.tsx` (mocks `utils/tutorial/tutorial` and `utils/explorer/explorer`, never the barrel)
- Modify: `client-v2/src/widgets/assistant/ui/Assistant.tsx` (`useProjectName` → title)
- Modify: `client-v2/src/widgets/assistant/ui/Assistant.test.tsx`
- Modify: `client-v2/src/views/sidebar/explorer/Component/Explorer.tsx`

**Interfaces:**
- Produces: `useTutorialBeforeStart(): string | null` — the name of the
  tutorial whose route is showing while it is not started, else `null`.
  Reads `PgTutorial.current?.name`; `null` while
  `PgExplorer.allWorkspaceNames` is unset or includes the name. Re-reads on
  `PgTutorial.onDidChangeCurrent`, `PgExplorer.onDidInit`,
  `PgExplorer.onDidSwitchWorkspace`, `PgExplorer.onDidCreateWorkspace`
  (sync's `importWorkspace` switches nothing), `PgExplorer.onDidDeleteWorkspace`,
  `PgExplorer.onDidChangeWorkspaceList`.

- [ ] **Step 1: Failing hook tests** (`renderHook`): on a tutorial route with
  no workspaces → `"Hello Anchor"`; with the workspace present → `null`; off
  the route (`current` null) → `null`; explorer uninitialised → `null`;
  firing the switch listener after the workspace appears → `null`.
- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3:** implement the hook (the `useProjectName` shape: a `read`,
  `useState(read)`, subscriptions in one effect).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Failing assistant tests**: with the hook mocked to
  `"Hello Anchor"`, no workspace → the head reads `Hello Anchor` and
  `Thread` gets `project="Hello Anchor"`; workspace `"Counter"` → both read
  `Counter`.
- [ ] **Step 6:** `Assistant`: `const project = useProjectName() ?? useTutorialBeforeStart()`
  (both hooks always called). Run → PASS.
- [ ] **Step 7:** `Explorer`: `if (useTutorialBeforeStart()) return null;`
  before the `NoWorkspace` branch (hook called before any return).
- [ ] **Step 8:** Playwright e2e in `e2e/tutorials.e2e.spec.ts`, one per
  scenario: "The assistant beside Hello Anchor" (fresh storage: head and
  `Ask about Hello Anchor`, no `Create a new project`); "Starting from the
  About page" (Hello Seahorse, which has no lesson chrome: Start lands on
  `/1` and `#root-dir` shows); "The details read as text" (`useInnerText`);
  "Beside another project" (`seededPage`: head `e2e-project`, no
  `#root-dir`). Run the file alone.
- [ ] **Step 9:** Commit `fix(client-v2): name the tutorial beside its About page and empty the files column (HOO-2254)`.

### Task 3: Verify and PR

- [ ] `yarn run check` green; touched e2e specs run alone
  (`yarn test-e2e e2e/<spec>`), green.
- [ ] Screenshots stand vs ours at 1440/834/393 of `/tutorials/hello-anchor`.
- [ ] `/sx:review-pr full`, `/sx:review-pr`; tick 1.1 and 1.2 in `tasks.md`.
