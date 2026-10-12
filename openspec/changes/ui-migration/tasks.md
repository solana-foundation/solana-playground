# Tasks

Each task is its own stream: its own worktree, ticket and small PRs. Tick a
task in the PR that lands it. Until 3.2 lands, new code may use Tailwind
utilities and tokens but no design-system components.

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

- [ ] 2.1 `design-system/` on `master-2.0` as its own package; builds and
      serves its catalogue (HOO-1852, PR #44)
- [ ] 2.2 Registry built from the repository with no outside URLs (HOO-1852,
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

- [ ] 4.1 Raise the browser floor: `browserslist` updated, build and bundle
      checked (HOO-1860)
- [ ] 4.2 Tailwind 4 beside styled-components and the `@/` alias; nothing on
      screen moves; the alias resolves in the build, the editor and tests
      (HOO-1861; after 4.1)
- [ ] 4.3 Token bridge: one palette for both systems, two themes, Monaco and
      xterm follow the theme (HOO-1802; after 4.2 and 2.1)

## 5. Screens

- [ ] 5.1 New layout shell with today's panels inside; the responsive
      breakpoint agreed (HOO-1854; after 3.6 and 4.3)
- [ ] 5.2 Panels move one by one, each by the change rule in
      `client-v2/CLAUDE.md` (one ticket per panel, to file; after 5.1)
- [ ] 5.3 Breakpoint screens, what the cut line says, by Nov 11 (ticket to
      file; after 5.2)
- [ ] 5.4 Global reset on, styled-components out; Monaco and xterm excluded
      from preflight or checked on their own (ticket to file; after
      Breakpoint)
