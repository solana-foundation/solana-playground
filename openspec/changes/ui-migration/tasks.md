# Tasks

Each task is its own stream: its own worktree, ticket and small PRs. Tick a
task in the PR that lands it. Until React 19 (3.2's PR #45) and the
in-repository registry (2.2's PRs #44 and #50) are on `master-2.0`, new code
may use Tailwind utilities and tokens but no design-system components. Both
are, since 2026-10-07. 3.2 and 3.3 were ticked after their PRs had merged,
in HOO-1859's PR (Lead's sweep, 2026-10-22).

## 1. Rules

- [x] 1.1 Record the nine decisions in the project's decision log and narrow
      the root rules on upstream to `client/` and `server/` (HOO-1857)
- [x] 1.2 `client-v2/CLAUDE.md` and `openspec/` on `master-2.0` (HOO-1858,
      PR #43)
- [x] 1.3 Layer check in CI: `eslint-plugin-boundaries` in `eslintConfig`,
      legacy roots excluded, a violation fails `yarn lint` and the build
      (HOO-1859; plan:
      [plans/1.3-layer-check.md](plans/1.3-layer-check.md))
- [ ] 1.4 Break the `auth` <-> `persistence` cycle: `auth`'s server module
      stops importing `persistence`'s pool, or the pool moves to `shared/`;
      then remove the exception (ticket to file): the imports between the
      pair and their `TODO(ui-migration 1.4)` lines; in
      `client-v2/eslint-layers.js`, `RECORDED_EXCEPTION`, the
      `layers/recorded-exception` rule and the allow policy for those files;
      the rule's re-export in `client-v2/eslint-plugin-layers/index.js`; the
      pinning test in `client-v2/scripts/eslint-layers.test.mjs`; and the
      exception scenario of the `client-v2-layers` spec. Until then the pair's
      imports warn (HOO-2285)
- [x] 1.5 ESLint for what review keeps finding, inside the layers, and the
      ids module moved to `shared/lib` (HOO-1897, PR #49)

## 2. Design system

- [x] 2.1 `design-system/` on `master-2.0` as its own package; builds and
      serves its catalogue (HOO-1852, PR #44)
- [x] 2.2 Registry built from the repository with no outside URLs (HOO-1852,
      PR #44)

## 3. Tools

- [x] 3.1 React 19 spike: what breaks, what the fixes cost (HOO-1840; see
      design.md)
- [x] 3.2 React 19 upgrade; the product looks and behaves the same; the gate
      in design.md passes (HOO-1850, PR #45)
- [x] 3.3 Jest to vitest; same test count as Jest today; no `jest.*` left in
      `src/` (HOO-1715, PR #46)
- [ ] 3.4 Lift the TypeScript `=5.0.4` pin; Monaco's TypeScript features
      still work (HOO-1855; after 3.3)
- [x] 3.5 e2e in CI, or the React 19 gate written down as a manual run
      (HOO-1856, PR #48: the `e2e` job; the production-build walk-through
      stays manual until 3.8 writes it as scenarios)
- [x] 3.6 First design-system components installed into `shared/ui` through
      the reinstall script (HOO-1949, PR #56; after 3.2, which landed as PR
      #45, and 2.2, which landed as PRs #44 and #50; HOO-1949 also
      moved the last bare `button`/`spinner`/`tooltip` dependencies into
      `@playground/`, guarded by `client-v2/scripts/registry.test.mjs`; plan:
      [plans/3.6-ds-shared.md](plans/3.6-ds-shared.md))
- [x] 3.7 `yarn spec:coverage` reports every scenario without a test
      titled `<capability>: <scenario name>` or a `(manual)` mark
      (HOO-1856, PR #48)
- [ ] 3.8 Scenarios as the test plan: the existing e2e tests get specs and
      scenario titles, and the React 19 gate is written as `(manual)`
      scenarios (HOO-1896; after 3.7)

## 4. Foundation

- [x] 4.1 Raise the browser floor: `browserslist` updated, build and bundle
      checked (HOO-1860)
- [x] 4.2 Tailwind 4 beside styled-components and the `@/` alias; nothing on
      screen moves; the alias resolves in the build, the editor and tests
      (HOO-1861; after 4.1)
- [x] 4.3 Token bridge: one palette for both systems, two themes, Monaco and
      xterm follow the theme (HOO-1802; after 4.2 and 2.1;
      plan: plans/4.3-token-bridge.md)

## 5. Screens

The screens move to the designer's prototype
(https://solana-playground-ds.vercel.app/#app) in big visible steps, then
the details: the frame, Home, the workspace, projects, the assistant and
lessons, then the rest. The prototype is built from PR #32, which is a
reference only: its screens are rebuilt on the design system, and #32 is not
merged. Each step installs the design-system components it needs; the small
elements are swapped app-wide on a parallel track (5.3-5.6) that depends on
nothing. Every step after 5.2 restyles inside a column 5.2 already placed.
Tablet keeps 5.1's layout, with one change from 5.2: between 768 and 1023 px
the navigation starts as a rail on every load (unfolding it is for the visit
and is not saved); the assistant stays the right Sheet, as in 5.1, until the
designer delivers a tablet layout (HOO-2056). A task that treats the rail on load as a
regression against 5.1 has misread this rule.

- [x] 5.1 New layout shell with today's panels inside; the editor read-only
      below 600 px (decided 2026-10-09); the classic layout removed
      (HOO-1854; after 3.6 and 4.3; plan: `plans/5.1-layout-shell.md`)
- [x] 5.2 Frame: the four-column frame, the header removed, today's pieces
      moved unchanged (HOO-2055; after 5.1; design.md, "The four-column
      frame (5.2)"; plan:
      [plans/5.2-four-column-frame.md](plans/5.2-four-column-frame.md))
- [x] 5.3 Elements: leaves (Tag, Callout, Badge, Checkbox, Switch,
      Collapsible, Kbd, Empty, StatusDot, Avatar, Logo) swapped app-wide; the
      legacy `Tag`, `Text`, `Checkbox`, `Foldable` and `ProgressBar` removed
      (HOO-2058; parallel; design.md, "Leaf elements (5.3)"; plan:
      [plans/5.3-leaf-elements.md](plans/5.3-leaf-elements.md))
- [x] 5.4 Elements: buttons (BrandButton, AsyncButton, CopyButton, HelpTip)
      (HOO-2059; parallel; design.md, "Buttons (5.4)"; plan:
      [plans/5.4-buttons.md](plans/5.4-buttons.md))
- [x] 5.5 Elements: controls (Stepper, Segmented, Select, NativeSelect,
      RadioGroup, Field) swapped app-wide; react-select and
      `components/Select` removed (HOO-2060; parallel; design.md, "Controls
      (5.5)"; plan: [plans/5.5-controls.md](plans/5.5-controls.md))
- [x] 5.6 Elements: menus and overlays (Dialog, Modal, DropdownMenu,
      ContextMenu, Popover, Drawer, Sonner) from the design system;
      react-toastify and the legacy `Menu`, `Modal`, `ModalBackdrop`,
      `Popover`, `Toast` and `Tooltip` removed (HOO-2061; parallel; plan:
      [plans/5.6-overlays.md](plans/5.6-overlays.md))
- [x] 5.7 Phone: the prototype's three-page structure below 720 px, the
      editor editable on a phone, replacing 5.1's read-only editor (HOO-2062;
      after 5.2; design.md, "The phone (5.7)"; plan:
      [plans/5.7-phone-pages.md](plans/5.7-phone-pages.md))
- [x] 5.8 Home replaces the gallery popup on start, desktop and phone
      (HOO-2063; after 5.2 and 5.7; design.md, "Home (5.8)"; plan:
      [plans/5.8-home.md](plans/5.8-home.md))
- [x] 5.9 Tutorials and Programs pages, opened from the navigation
      (HOO-2064; after 5.2 and 5.8; design.md, "Tutorials and Programs pages
      (5.9)"; plan: [plans/5.9-catalog-pages.md](plans/5.9-catalog-pages.md))
- [x] 5.10 Workspace: the Write stage, editor tabs, console drawer and
      terminal look (HOO-2065; after 5.2; plan:
      [plans/5.10-write-stage.md](plans/5.10-write-stage.md))
- [x] 5.11 Workspace: the Build and Deploy stages (HOO-2066; after 5.2;
      design.md, "Build and Deploy stages (5.11)"; plan:
      [plans/5.11-build-deploy-stages.md](plans/5.11-build-deploy-stages.md))
- [x] 5.12 Workspace: the Interact stage (HOO-1676; after 5.2; design.md,
      "The Interact stage (5.12)"; plan:
      [plans/5.12-interact-stage.md](plans/5.12-interact-stage.md))
- [x] 5.13 Projects: New project (HOO-2068; after 5.2 and 5.9; design.md,
      "New project (5.13)"; plan:
      [plans/5.13-new-project.md](plans/5.13-new-project.md))
- [x] 5.14 Projects: the project list in the navigation, with pins, rename,
      duplicate and zip (HOO-2069; after 5.2 and 5.6; design.md, "The
      project list (5.14)"; plan:
      [plans/5.14-project-list.md](plans/5.14-project-list.md))
- [x] 5.15 Projects: the session footer and account menu (HOO-2070; after
      5.2 and 5.6; design.md, "Session footer and account menu (5.15)";
      plan: [plans/5.15-session-footer.md](plans/5.15-session-footer.md))
- [x] 5.16 Projects: the Get set up checklist (HOO-2075; after 5.15;
      design.md, "The Get set up checklist (5.16)"; plan:
      [plans/5.16-setup-list.md](plans/5.16-setup-list.md))
- [x] 5.17 Assistant: the composer and Connect a model (HOO-2067; after 5.2;
      design.md, "The composer and Connect a model (5.17)"; plan:
      [plans/5.17-composer-connect.md](plans/5.17-composer-connect.md))
- [x] 5.18 Assistant: the thread, messages, diffs and approvals (HOO-1794;
      after 5.17; design.md, "The assistant thread (5.18)"; plan:
      [plans/5.18-assistant-thread.md](plans/5.18-assistant-thread.md))
- [x] 5.19 Lessons: objective band, step rail, Steps and Files, the reader
      (HOO-2076; after 5.2 and 5.10; design.md, "Lessons (5.19)"; plan:
      [plans/5.19-lessons.md](plans/5.19-lessons.md))
- [x] 5.20 Details: Settings as a full page (HOO-2071; after 5.5 and 5.6;
      design.md, "Settings as a full page (5.20)"; plan:
      [plans/5.20-settings-page.md](plans/5.20-settings-page.md))
- [x] 5.21 Details: the tutorial page, its empty and error states
      (HOO-2072; after 5.2; plan:
      [plans/5.21-tutorial-empty-error.md](plans/5.21-tutorial-empty-error.md))
- [ ] 5.22 Details: the tablet layout (HOO-2073; after the designer's
      HOO-2056)
- [ ] 5.23 Details: the wallet (HOO-2074; after the designer's HOO-2057)
- [ ] 5.24 Global reset on, styled-components out; Monaco and xterm excluded
      from preflight or checked on their own (HOO-2077; after every other
      task in this section)
- [x] 5.25 Frame chrome: flush columns with 1 px dividers, the 44 px bars
      over the assistant (5.17's head) and the stage, full-width stage tabs;
      a hidden assistant or files column takes no width (HOO-2122; after 5.2,
      5.10 and 5.17; design.md, "Frame chrome (5.25)"; plan:
      [plans/5.25-frame-chrome.md](plans/5.25-frame-chrome.md))
- [x] 5.26 The files column keeps its open folders, scroll and lesson tab
      while hidden (HOO-2124; after 5.25; plan:
      [plans/5.26-files-column-keeps-its-state.md](plans/5.26-files-column-keeps-its-state.md))
- [x] 5.27 Failed clicks tell the user: a toast says what did not happen,
      once (HOO-2100; after 5.4 and 5.6; design.md, "Failed clicks (5.27)";
      plan: [plans/5.27-failed-clicks.md](plans/5.27-failed-clicks.md))
- [x] 5.28 Home from an open project: the navigation's Home and the last
      project's delete lead to Home, and going back keeps the editor, its
      undo history and the console (HOO-2118; after 5.8; design.md, "Home
      from an open project (5.28)"; plan:
      [plans/5.28-home-from-an-open-project.md](plans/5.28-home-from-an-open-project.md))
- [x] 5.29 SearchBar from the design system: an input group with a Command
      list in a Popover, for the Interact instruction inputs, FromSeed and
      Account (HOO-2207; after 5.12, before 5.24; its own change:
      `searchbar-command`)
- [x] 5.30 No left Sheet: the phone's line moves to the stock Sidebar's 768,
      so below it the pager holds the navigation apart from the files, and
      from 768 to 1023 the navigation starts as a rail beside the files
      column (HOO-2208; Slava 2026-10-22)
