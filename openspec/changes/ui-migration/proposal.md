# Proposal

## Why

The designer has shipped a design system in code: shadcn/ui and Tailwind 4 on
Playground's tokens, 60 stock components and 26 of ours, in a standalone Vite
package on PR #32. The customer has approved the redesign built on it.
`client-v2` cannot use any of it today:

- It runs React 17. Every design-system component passes `ref` as a plain
  prop (0 `forwardRef` across 86 files, 61 `asChild` uses), which React 17
  drops.
- It styles through styled-components (154 files) and a JS theme object, with
  about 60 hand-written colours. There is no CSS-variable layer for Tailwind
  or shadcn to read.
- Its browser list reaches back to Safari 14 and Chrome 67. Tailwind 4 needs
  Safari 16.4, Chrome 111 and Firefox 128.
- Its code is organised by kind (`components/`, `views/`, `utils/`), so there
  is no agreed place for a new component or a rule about what it may import.

Several people and several Claude Code sessions work on the client at once. A
one-pass rewrite would block them all, and it would land nothing before
Breakpoint (Nov 15-17). The design freeze is Nov 11. So the move happens in
parallel streams, each small enough to review, with a written rule for when
existing code moves.

## What Changes

- The stack becomes Tailwind 4, `class-variance-authority`, shadcn/ui on
  Radix, React 19 and vitest. Create React App stays for now.
- `client-v2` stops tracking the upstream frontend; upstream work arrives as
  features with their own tickets. `client/` stays byte-identical to
  upstream.
- Two themes, the design system's dark (default) and light, replace the five
  switchable themes.
- The browser floor rises to Safari 16.4, Chrome 111, Firefox 128, Edge 111.
- New code lives in feature-sliced layers; the existing roots are legacy and
  move by a change rule, not by a sweep.
- Our components come in pairs: a `Base<Name>` built from design-system
  parts, and a connected `<Name>`.
- `design-system/` moves from PR #32 into the repository as its own package
  with a registry that has no outside links; `client-v2` installs from it.
- The new layout shell is built once, on React 19, with today's panels
  inside. Then the app moves to the designer's prototype in big steps (the
  four-column frame, Home, the workspace, projects, the assistant and
  lessons, the details), while the small elements are swapped app-wide on a
  parallel track.
- The classic layout (`?classic`) is removed with the shell; Flow is the only
  layout.
- The layout shell adds the telemetry events `layout_panel_toggled`,
  `layout_viewport` (field `viewport`), `layout_readonly_edit_blocked` and
  `layout_restore_failed` (prefix `layout`), described in the
  `client-v2-layout` spec. The four-column frame names the panels in
  `layout_panel_toggled` `nav`, `files`, `assistant` and `console` (`left`
  is gone), and its navigation (`widgets/app-nav`) adds `nav_item_opened`
  (prefix `nav`).

## Capabilities

### New Capabilities

- `client-v2-layers`: where new frontend code lives and what it may import
  (feature-sliced layers, legacy roots, slice doors, the component pair).
- `client-v2-themes`: which themes the product offers, the default, and what
  happens to a saved theme that no longer exists.
- `client-v2-browser-support`: the browsers the production bundle targets.
- `client-v2-layout`: the arrangement of the panels, what of it survives a
  reload, how it changes with screen width, and where the editor is read-only.

### Modified Capabilities

None. `openspec/specs/` is empty before this change; these are the first
capabilities it records.

## Impact

- `client-v2/package.json`: React 19, Tailwind 4, PostCSS 8.5, browserslist,
  vitest; a `design-system` workspace dependency.
- `client-v2/src`: every component eventually; in this change the new layers
  (`features/`, `shared/`, `widgets/`, `entities/`), `src/themes/` (three
  themes removed), `utils/theme/theme.ts` (the `dark` class), `Monaco.tsx`
  and `Terminal.tsx` (resolved colours), `app/` (the shell).
- `client-v2/craco.config.js`, `tsconfig.paths.json`: Tailwind through
  PostCSS, the `@/` alias.
- `design-system/`: new top-level package, catalogue site, registry build.
- CI: `client-v2.yml` gains the layer check (`eslint-plugin-boundaries`) and
  the e2e gate or its written manual equivalent.
- `client-v2/src/app/Panels`: the classic layout (`Side`, `Main/Secondary`,
  `Bottom`) is removed. `re-resizable` stays: the tutorial view uses it.
- Users: anyone on a removed theme lands on dark and is told once.
- Out of scope: Next, merging PR #32, the undesigned parts of the design
  system (search, project list and switcher, input validation, toast progress
  bar, wallet window, phone lesson bar).
