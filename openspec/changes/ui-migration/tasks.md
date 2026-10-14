# Tasks

Each task is its own stream: its own worktree, ticket and small PRs. Tick a
task in the PR that lands it. Until React 19 (3.2's PR #45) and the
in-repository registry (2.2's PRs #44 and #50) are on `master-2.0`, new code
may use Tailwind utilities and tokens but no design-system components. Both
are, since 2026-10-07. Ticking 3.2 is its own stream's call, and does not
hold the components back.

## 1. Rules

- [x] 1.1 Record the nine decisions in the project's decision log and narrow
      the root rules on upstream to `client/` and `server/` (HOO-1857)
- [x] 1.2 `client-v2/CLAUDE.md` and `openspec/` on `master-2.0` (HOO-1858,
      PR #43)
- [ ] 1.3 Layer check in CI: `eslint-plugin-boundaries` in CRA's ESLint,
      legacy roots excluded, a violation fails the build (HOO-1859)
- [ ] 1.4 Break the `auth` <-> `persistence` cycle: `auth`'s server module
      stops importing `persistence`'s pool, or the pool moves to `shared/`;
      then drop the exemption from the boundary check and the
      `client-v2-layers` spec (ticket to file; before 1.3 enforces features)
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
- [ ] 3.2 React 19 upgrade; the product looks and behaves the same; the gate
      in design.md passes (HOO-1850, PR #45)
- [ ] 3.3 Jest to vitest; same test count as Jest today; no `jest.*` left in
      `src/` (HOO-1715, PR #46)
- [ ] 3.4 Lift the TypeScript `=5.0.4` pin; Monaco's TypeScript features
      still work (HOO-1855; after 3.3)
- [x] 3.5 e2e in CI, or the React 19 gate written down as a manual run
      (HOO-1856, PR #48: the `e2e` job; the production-build walk-through
      stays manual until 3.8 writes it as scenarios)
- [x] 3.6 First design-system components installed into `shared/ui` through
      the reinstall script (HOO-1949, PR #56; after 3.2, which landed as PR
      #45, and 2.2, which landed as PRs #44 and #50; both leave their own
      ticks to their owners; HOO-1949 also
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
- [ ] 5.3 Elements: leaves (Tag, Callout, Badge, Checkbox, Switch, Progress,
      Collapsible and the like) swapped app-wide (HOO-2058; parallel)
- [ ] 5.4 Elements: buttons (BrandButton, AsyncButton, CopyButton, HelpTip)
      (HOO-2059; parallel)
- [ ] 5.5 Elements: controls (Stepper, Segmented, Select, NativeSelect,
      RadioGroup, Field, InputGroup) (HOO-2060; parallel)
- [ ] 5.6 Elements: menus and overlays (Dialog, Modal, DropdownMenu,
      ContextMenu, Popover, Drawer, Sonner) (HOO-2061; parallel)
- [ ] 5.7 Phone: the prototype's three-page structure from 720 px, the
      editor editable on a phone, replacing 5.1's read-only editor (HOO-2062;
      after 5.2)
- [ ] 5.8 Home replaces the gallery popup on start, desktop and phone
      (HOO-2063; after 5.2)
- [ ] 5.9 Tutorials and Programs pages, opened from the navigation
      (HOO-2064; after 5.2)
- [ ] 5.10 Workspace: the Write stage, editor tabs, console drawer and
      terminal look (HOO-2065; after 5.2)
- [ ] 5.11 Workspace: the Build and Deploy stages (HOO-2066; after 5.2)
- [ ] 5.12 Workspace: the Interact stage (HOO-1676; after 5.2)
- [ ] 5.13 Projects: New project (HOO-2068; after 5.2)
- [ ] 5.14 Projects: the project list in the navigation, with pins, rename,
      duplicate and zip (HOO-2069; after 5.2 and 5.6)
- [ ] 5.15 Projects: the session footer and account menu (HOO-2070; after
      5.2 and 5.6)
- [ ] 5.16 Projects: the Get set up checklist (HOO-2075; after 5.15)
- [ ] 5.17 Assistant: the composer and Connect a model (HOO-2067; after 5.2)
- [ ] 5.18 Assistant: the thread, messages, diffs and approvals (HOO-1794;
      after 5.17)
- [ ] 5.19 Lessons: objective band, step rail, Steps and Files, the reader
      (HOO-2076; after 5.2 and 5.10)
- [ ] 5.20 Details: Settings as a full page (HOO-2071; after 5.5 and 5.6)
- [ ] 5.21 Details: the tutorial page, its empty and error states
      (HOO-2072; after 5.2)
- [ ] 5.22 Details: the tablet layout (HOO-2073; after the designer's
      HOO-2056)
- [ ] 5.23 Details: the wallet (HOO-2074; after the designer's HOO-2057)
- [ ] 5.24 Global reset on, styled-components out; Monaco and xterm excluded
      from preflight or checked on their own (HOO-2077; after every other
      task in this section)
