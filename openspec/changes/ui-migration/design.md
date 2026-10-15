# Design

## Context

`client-v2` is a copy of upstream's Create React App client plus the fork's
work: React 17, CRA 5 with craco, styled-components 5.3 with a JS theme object
(`src/themes/`), Jest 27 through `craco test`, TypeScript pinned at `=5.0.4`
by a `resolutions` entry, `browserslist.production` reaching Safari 14. The
design system (PR #32, `design-system/` at `4fcb29b`) is a Vite package on
React 19, Tailwind 4 and shadcn/ui, with a shadcn registry whose
`registryDependencies` point at `https://solana-playground-ds.vercel.app`.

Constraints that shape the approach:

- Parallel work. Several streams land small PRs on `master` at once; no
  step may block the others for long.
- Dates. Design freeze Nov 11; Breakpoint Nov 15-17; the design system's own
  v0 is also due Nov 11.
- Hosting is Vercel and Next is the long-term shape of the client. That
  direction stands; this change does not take it.
- The React 19 spike (HOO-1840, 2026-10-01) measured the upgrade: see "What
  the spike measured" below.

## Goals / Non-Goals

**Goals:**

- Every new component is built from the design system, in a known layer,
  once the foundation is in place.
- Existing code moves when a change touches it and the move is cheap, by a
  written rule both people and agents can apply.
- The design system has one source in the repository; `client-v2` installs
  from it and never edits the installed files by hand.
- The rules live on `master`, where every contributor's agent reads
  them.
- The new layout is the first screen built this way.

**Non-Goals:**

- Rewriting the client in one pass, or moving every existing component.
- Moving off Create React App.
- Merging PR #32; it stays a reference, harvested one ticket at a time.
- Keeping `client-v2` in sync with the upstream frontend.
- The design system's undesigned parts (see the proposal's Impact).

## Decisions

1. **Stack: Tailwind 4, cva, shadcn/ui on Radix, React 19, vitest.** This
   replaces the earlier choice to carry the redesign on the app's native
   theme registry, which named the move off React 17 as its own revisit
   condition. _Rejected:_ keeping the native registry (it cannot render a
   single design-system component); Tailwind without shadcn (re-implements
   the 60 stock components); moving to Next or Vite first (nothing here
   needs it, Tailwind 4 runs through craco's PostCSS, and a framework move
   on top of a React and styling move would block every stream). _Revisit
   when_ CRA blocks a step: PostCSS ordering, cssnano 5 on Tailwind 4 output,
   `react-refresh` 0.11 on React 19.
2. **`client-v2` is not synced with the upstream frontend.** Wanted upstream
   work is ported as a feature with its own ticket. `client/` stays
   byte-identical; `server/` is not modified. _Rejected:_ keeping `client-v2`
   syncable (after React 19, a new styling system and layers, a sync is a
   rewrite). _Open:_ how the tech lead's upstream work (the rust-analyzer
   LSP) reaches `client-v2`.
3. **Two themes.** The design system's dark (default) and light. _Rejected:_
   keeping every theme (each needs its own mapping onto the tokens, and the
   design system defines two); dark only (the design system ships light, and
   some users need it). _Revisit when_ the designer adds a theme.
4. **Browser floor at Tailwind 4's.** _Rejected:_ Safari 14 on Tailwind 3 (a
   fork of the design system); polyfills (`@property` and `color-mix()` have
   no faithful ones). _Revisit when_ real traffic below the floor shows up.
5. **Feature-sliced layers, legacy roots outside them.** `app -> widgets -> features -> entities -> shared`; no `pages` (widgets play it on a
   one-screen IDE); no `@x`. _Rejected:_ moving all code now; a `pages`
   layer; `@x`. _Revisit when_ a second screen with its own route tree
   appears, or two entities need each other twice.
6. **Component pairs.** `Base<Name>` (design-system parts, props only) and
   `<Name>` (data wired in); shadcn names stay unprefixed; install, do not
   rewrite. _Rejected:_ one component that fetches its own data (the
   catalogue cannot render it); `*View`/`*Container` suffixes.
7. **The design system as a package in the repo.** Catalogue instead of a
   Storybook; registry built from the repo with no outside hosts.
   _Rejected:_ copying components into `client-v2/src` by hand; a Storybook
   in `client-v2`; installing from the Vercel host (an outside host in the
   install path). _Revisit when_ the design system is published as a
   versioned package.
8. **The layout waits for React 19** and is built once (`react-resizable- panels` v4 needs React 18 or 19). _Rejected:_ a React 17 shell on
   `re-resizable`, rebuilt later. _Revisit when_ the upgrade slips past early
   November: the Breakpoint cut line decides.
9. **Feature folders: `ui/` for new slices, pending the tech lead.** The
   existing convention from the conversations review says `Component/`; FSD
   says `ui/`. `auth` and `persistence` stay as they are until he answers.

## How the design system reaches the code

```
Figma --> design-system/ (package) --> registry (built in the repo)
                                          |
                                          | shadcn add
                                          v
client-v2/src/shared/ui --> Base<Name> (slice ui/) --> <Name> (data wired in)
```

The flow runs one way. A change to a shared component is made in
`design-system/` and reinstalled. `shared/ui` holds only installed files, so
the hand-written `shared/ui/gradient-button` moves out.

Work on the package as it moves in:

- `registryDependencies` are rewritten from the Vercel host to names inside
  the repo.
- `message-scroller` and `questionnaire` import `@shadcn/react` (React 19);
  it becomes a `client-v2` dependency when they are first installed.
- `combobox` alone is built on `@base-ui/react`. The first ticket that needs
  it decides Base UI or a Radix rebuild, so the client carries one set of
  primitives.
- Stack Sans and Manrope load from Google Fonts in `tokens.css`; the dev
  server sends `Cross-Origin-Embedder-Policy: require-corp`, so `client-v2`
  hosts them beside the code fonts in `public/fonts`.

`client-v2/components.json` maps `ui` to `@/shared/ui`, `lib` to
`@/shared/lib`, `hooks` to `@/shared/lib/hooks`. A script reinstalls with
`--overwrite`, because the CLI does not overwrite silently. Components with
product names (composer, console drawer, step rail, editor tabs, terminal,
diff, diagnostic, setup list, objective band, achievement) live in
`shared/ui` as a stated exception; their connected versions live in the slice
that owns the data.

## Tokens and themes

`tokens.css` is the source of colour, type, radius, elevation and motion.
`:root` is light (paper); `.dark` is the product. It reaches the code only
through `yarn ds-add playground-tokens`, which installs
`src/app/styles/playground-tokens.css` and `playground-theme.css`; neither is
edited by hand, and no token is added for the playground's sake (a legacy
role without one maps to the nearest). `src/index.css` imports both and
declares `@custom-variant dark (&:is(.dark *))`, so `dark:` follows the class,
not the OS. `PgTheme.set` toggles `dark` on `<html>` next to `colorScheme`.

- **The theme object holds references.** Every colour in the
  styled-components theme is `var(--token)`, so one object serves both themes
  and the class switches every value. Alpha is `PgTheme.alpha(color, level)`,
  a `color-mix(in srgb, ...)` at 9, 39 or 73 per cent (the weights of the old
  `16`, `64`, `bb` suffixes). _Rejected:_ values resolved at switch time (a
  second copy of the palette in JS, and hex concatenation breaks on any token
  not written `#rrggbb`); a hybrid of both (two kinds of value in one object).
- **Monaco, xterm and shiki get plain values.** They cannot read a CSS
  variable. `shared/lib/css-color` resolves one through `getComputedStyle` on
  a probe element and turns the `rgb()` or `color(srgb ...)` it reports into
  hex; a value that does not resolve becomes transparent, with one warning.
  Monaco redefines its theme and xterm recolours in place on every change, so
  terminal output survives.
- **Two names.** `Dark` (the default) and `Light`. A saved `Playground`,
  `Dracula` or `Solana` falls back to Dark and is told once; `Solana V2`,
  written on every first load and so nobody's choice, and any unknown name
  fall back silently. The fallback rewrites the existing `theme` key at once,
  so there is no new storage key; the `theme-migration-solana-v2*` flags go.
  The notice waits in memory for a start-up effect mounted after `Toast`,
  because a toast sent before `Toast` mounts is lost.
- **Literals are guarded.** `scripts/check-colors.mjs` runs in
  `yarn run check` and in CI, and fails on any hex colour or colour function
  (`rgb()`, `hsl()`, `color(srgb ...)` and the like) outside the installed
  token files, `shared/lib/css-color` and the third-party logo colours in
  `languages/`. Named colours (`white`, `red`) are not caught: the words are
  too common in code to tell from a colour without parsing CSS. Sidebar icons colour through a CSS mask over the
  text colour, which reaches the rail's raster icons too.

## Tailwind inside Create React App

- `@tailwindcss/postcss` runs through craco's PostCSS config in `file` mode,
  ahead of CRA's own plugins; `extends` mode appends it after them, which is
  the wrong order.
- PostCSS moves from 8.4.12 to 8.5.16 or newer.
- Preflight stays off until the last global style is gone.
- `@source` names `src/` explicitly so Tailwind does not scan `public/`.
- cssnano 5 is checked on Tailwind 4 output (`@property`, `@layer`,
  `color-mix()`) in the first Tailwind ticket.

## The `@/` alias

CRA deletes `compilerOptions.paths` from `tsconfig.json` on every start
(`verifyTypeScriptSetup.js`). The alias lives in `tsconfig.paths.json`, which
`tsconfig.json` extends, plus craco `webpack.alias`, plus the test runner's
resolver (Jest `moduleNameMapper` until vitest, then `resolve.alias`).

## What the spike measured (HOO-1840)

Branch `spike/react-19`, never merged. A 23-step Playwright walk-through ran
on React 17 and 19, in development (strict mode) and as a production build.

- 23 of 23 steps behave the same; every screenshot identical apart from the
  caret. Unit tests 657 of 657.
- Fixed in the spike: two concurrent `PgExplorer.init` calls (EEXIST; the
  race is old, strict mode makes it certain; fix: serialise them); 1135 type
  errors (one `resolutions` line, `@types/styled-components` 5.1.36,
  `types-react-codemod`, about ten manual fixes); `react-markdown` 9 passes
  one child where 8 passed an array.
- Not fixed in the spike: a deep link into an unstarted lesson
  (`/tutorials/hello-anchor/1`) lands on `/`; the route's sidebar listener
  reads its own sidebar change as "the user left".
- Not needed: styled-components 6, a `react-toastify` upgrade, lifting the
  TypeScript pin.
- Not covered: a real deploy, the assistant with a key, an external wallet,
  Flow steps after a build.

## The React 19 gate

The unit suite renders React in one file, so a green run says little. The
gate is the e2e suite (`client-v2/e2e/`; HOO-1856 puts it in CI or writes
the manual run down) plus a manual walk-through in development and in the
production build: the editor (open, switch, rename, delete; start screen and
back; format Rust and TypeScript; Vim; completions; autosave across a
reload), the terminal (input, resize, no leaked `PgTerm` from the `useMemo`
factory running twice under strict mode), hot reload (`react-refresh` 0.11;
fallback `FAST_REFRESH=false`).

| Library                 | With React 19                                         | Action                                                                                   |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `typescript` `=5.0.4`   | `@types/react` 19 declares TS 5.6                     | Lift the pin (HOO-1855), not first                                                       |
| `styled-components` 5.3 | Runs; 5.1.36 types accept React 19                    | Keep 5                                                                                   |
| `react-use-clipboard`   | No release supports React 19                          | Replace in `hooks/useCopy.tsx`; 5.4 kept it, for Wallet Settings' Copy address menu item |
| `react-select` 5.5      | Peer range excludes 19                                | Removed by 5.5                                                                           |
| `re-resizable` 6.9      | Peer range excludes 19                                | 6.11 or newer                                                                            |
| `react-rnd` 10.3        | Works (passes `nodeRef`, so `findDOMNode` is skipped) | Bump anyway                                                                              |
| Our code                | 20+ `FC` with implicit `children`; 9 global `JSX.`    | Mechanical fixes                                                                         |

HOO-1772 and HOO-1773 change the Monaco and language-server modules; they do
not land in the same week as the upgrade.

## The layout shell (5.1)

Decided with Slava on 2026-10-09 (HOO-1854, folding in HOO-1793).

- **Flow is rebuilt; classic is removed.** The shell replaces Flow's grid.
  `?classic` and its `Side`, `Main/Secondary` and `Bottom` go, because Flow
  already reaches classic's extra pages (Interact, the gallery,
  `ProgramsTab`). `app/Panels/Main/Primary` stays: the Write stage mounts it.
  `components/Resizable` and `re-resizable` stay: the tutorial view
  (`components/Tutorial/views/Main.tsx`) uses them.
  `PgView.sidebar` stays: routes and tutorials write it.
- **The left panel is the stock `Sidebar`**, folding to an icon rail: 14.5 rem
  open, 3.25 rem as a rail, ⌘B, as the design system's migration map has it.
  The widths go through `SidebarProvider`'s `style`; `shared/ui` is not
  edited. (5.2 replaces what follows: the header is removed and the Sidebar
  holds the navigation; see "The four-column frame (5.2)".) The header keeps
  the full width on top (Slava, 2026-10-09): the
  stock Sidebar is `fixed` at the window's full height, so the shell's
  `className` makes it `absolute` inside the area under the header, and the
  provider `flex-1` instead of `min-h-svh`. The panel is no longer drag-resizable (today 192 px to 30% of the
  window). _Rejected:_ one `ResizablePanelGroup` for all three columns, which
  keeps the drag but rebuilds the Sidebar's phone Sheet and ⌘B by hand; a
  drag handle added to the stock Sidebar, which edits `shared/ui`.
- **Assistant and console become resizable** (through `shared/ui/resizable`,
  sizes in px), and fold. The console folds to a 28 px handle (not 0) and stays
  mounted so the xterm session lives; the assistant folds to a 24 px strip and
  unmounts its content, as today.

```
widgets/layout-shell/
  ui/LayoutShell.tsx      connected: the state, the keys, the panels the
                          product opens on its own, telemetry
  ui/BaseLayoutShell.tsx  markup only: SidebarProvider, the two panel groups,
                          the Sheets; slots left/stage/console/assistant
  model/layout-state.ts   the saved layout, one localStorage key
  model/use-layout-state.ts  the state hook: restore, toggle, save
  model/telemetry.ts      the `layout_*` events
```

`app/Panels/Side/Left/Settings.tsx` (and `CustomSetting.tsx`) stay with the
classic panels' removal: `GearSidebar` uses them.

`useViewport()` (wide >=1024, compact 600-1023, phone <600) lives in
`shared/lib/hooks/use-viewport.ts`, because Monaco reads it too. Monaco
announces a blocked edit as a `PgEditor` document event, so the editor does
not import the widget.

```
SidebarProvider (collapsible="icon", controlled open)
├─ Sidebar → LeftPanel (unchanged inside)
└─ SidebarInset → Group horizontal
   ├─ Panel center → Group vertical: stage (ObjectiveBand + StageRouter) | console
   └─ Panel assistant (a right Sheet on compact and phone)
```

**What survives a reload.** One `localStorage` key, `layout`, under 200
bytes, stored as the state is: `{v: 1, open: {left, assistant, console},
h?, vert?}`, where `h` and `vert` are the two groups' layouts from
`onLayoutChanged`, in percent and summing to 100, saved only when the user
drags (not on mount, not per frame, not when the window resizes) and never
kept for a folded panel (assistant: `h`, console: `vert`), so a reload sizes
that panel from its flag. A size map that does not read is dropped alone; the
open flags are kept. A restored size that the library folds on mount does not
rewrite the flag: the panel is put back to its open size.
The panel constraints are in px (assistant 280 to 560, console 120 minimum).
A layout saved by a newer version is read as the defaults and never
overwritten. A corrupt value, another `v` or unavailable
storage falls back to today's defaults (left open, assistant open at 21.75
rem, console closed, 16 rem when opened), is logged through
`createLogger("layout-shell:state")` and sends `layout_restore_failed`. Crossing a breakpoint writes nothing. The widget
owns the state; the subscriptions that open panels on their own
(`deploy.onDidStart` and a failed deploy open the console,
`PgAssistant.onDidRequestPrompt` the assistant) move into it unchanged.

**Width.** `LAYOUT_BREAKPOINTS = { compact: 1024, left: 768, phone: 600 }`.
`left` is not a viewport class: it names the stock Sidebar's own threshold,
and a unit test holds it to `use-mobile`.

| Width | Left | Assistant | Editor |
|---|---|---|---|
| wide >=1024 | Sidebar or rail | resizable panel | edits |
| compact 600-1023 | rail from 768; the stock Sheet below 768 | right Sheet; "Expand assistant" on the right edge, Ctrl+R | edits |
| phone <600 | the stock Sheet | full-width Sheet | read-only |

The stock Sidebar turns into its Sheet at 768 px (`use-mobile`), so there are
three thresholds; that is accepted rather than editing `shared/`. On a phone
Monaco gets `readOnly`, and the message that editing works from 600 px is
shown through Monaco's message controller (0.37 has no `readOnlyMessage`
option); chat works at every width. Explorer actions are not made read-only.
The header is gone since 5.2; its compact steps, `STEPPER_COMPACT_AT` (80 rem)
and `CHIPS_COMPACT_AT` (72 rem), are kept as they are until 5.10 and 5.15
restyle the stage bar and the footer. The phone's own structure is 5.7
(HOO-2062).

**Telemetry** (prefix `layout`, `model/telemetry.ts`): `layout_panel_toggled
{panel, open, via: button | key | drag | auto}`, `via: drag` when dragging an
edge folded or unfolded it, `via: auto` when a deploy or "Fix with assistant"
opened it; `layout_viewport {viewport}` once per load;
`layout_readonly_edit_blocked` once per page load, from Monaco's
`onDidAttemptReadOnlyEdit`; `layout_restore_failed {reason: corrupt | version
| storage-unavailable}`.

Kept: every id, `aria-label`, `#tabs`, `#root-dir`, and the keys ⌘B, Ctrl+R,
Ctrl+J. The folded rail grows from 24 px to 52 px, which
`left-panel-toggle.e2e` asserts and is updated for.

## The four-column frame (5.2)

Decided with Slava on 2026-10-13 (HOO-2055), the first step of the plan in
`tasks.md` section 5. The app takes the prototype's frame; every piece inside
it moves unchanged, so later tasks restyle inside a column that already
exists.

```
SidebarProvider (collapsible="icon", controlled open, ⌘B)
├─ Sidebar → AppNav: logo, Home, New project, Tutorials, Programs,
│            ProjectSwitcher (as is), footer: StatusChips (as is) and
│            FeedbackTrigger (the form and its state sit in
│            FeedbackHost, above the shell); on the rail, RailFooter:
│            the cluster's dot and the account
└─ SidebarInset → Group horizontal (id layout-horizontal)
   ├─ Panel assistant (left; folds to its 24 px strip; a right Sheet below
   │                   LAYOUT_BREAKPOINTS.compact, as in 5.1)
   └─ Panel work
      ├─ stage bar: Stepper (as is, with Ctrl+1..4)
      └─ Group horizontal (id layout-work)
         ├─ Panel files: LeftPanel (as is; folds to its 52 px rail, ⌘E)
         └─ Panel center
            └─ Group vertical (id layout-vertical): stage (ObjectiveBand +
               StageRouter) | console (Ctrl+J)
```

- **The header is removed.** The logo and `ProjectSwitcher` go to the top of
  the navigation, `StatusChips` (cluster, wallet, settings) to its footer, the
  `Stepper` and its Ctrl+1..4 keys to the stage bar. In the rail the switcher
  and the chips are hidden; the four items keep their icons, with a tooltip.
  The rail's footer holds two icons, as the prototype draws it: the
  cluster's dot, coloured by its status like the chip's, which opens the
  settings on the cluster, and the account (the avatar, or a user icon),
  which unfolds the navigation. The feedback trigger is not on the rail; the
  prototype keeps "Report a bug" in the account's menu. Between 768 and 1024
  the rail is where the navigation starts, so without its footer a cluster
  that is down would show nowhere.
  The sync banner stays above everything, full width.
- **The stage bar spans the files column and the stage**, as the prototype
  draws it, not the files column alone.
- **The navigation is a widget, `widgets/app-nav`**: `BaseAppNav` built from
  the installed `Sidebar*` parts and `lucide-react` icons, slots for the
  switcher and the footer; `AppNav` connected. Until Home (5.8) and the
  Tutorials and Programs pages (5.9) exist, every item opens the existing gallery
  (`NewWorkspaceModal`): Home and New project on its default tab, Tutorials
  and Programs on theirs, through a new `initialTab` prop. _Rejected:_
  hiding Home until 5.8; disabled items saying "soon".
- **Keys.** ⌘B folds the navigation (the stock Sidebar's own key), ⌘E the
  files column, Ctrl+R the assistant, Ctrl+J the console. The files toggle
  keeps "Collapse project panel" / "Expand project panel" and the rail's "New
  file"; its hint reads ⌘E. Below 768 ⌘E opens and closes the Sheet that
  holds the files column. On macOS Monaco keeps ⌘E (find with selection)
  while the editor has focus, so the shell's ⌘E works outside the editor
  there; on Windows and Linux Ctrl+E folds the column from the editor too.
  _Rejected:_ ⌘B staying on the files column, leaving the navigation to its
  button alone.
- **Width.** From `LAYOUT_BREAKPOINTS.compact` (1024) every column is in
  place. Between `left` (768) and 1024 the navigation starts as a rail on
  every load; ⌘B or its button unfold it for the visit, and that is not
  saved. The files column stays, and the assistant is the right Sheet, as in
  5.1. Below 768 the navigation and the files column share the stock
  Sidebar's Sheet, opened by "Expand project panel" at the left edge, as the
  project panel's Sheet was in 5.1; the files toggle and ⌘E open and close
  that Sheet.
  A phone has no room for a files column, and its own structure is 5.7.
- **Panels.** The assistant is 280 to 560 px as in 5.1; the files column
  opens at 14.5 rem, folds to 3.25 rem and resizes from 12 rem, with no
  maximum of its own (a 30% cap fell below its own minimum on a 1024 px
  window); the stage keeps at least 240 px. The work area's minimum is the
  files column's minimum, a handle and the stage's minimum (440 px), so on a
  1024 px window the assistant gives way below its 348 px default. Opening goes through
  `resize(openSize)`, never `expand()`, and only `onLayoutChanged` with
  `isUserInteraction` saves, as 5.1 learned.
- **What survives a reload** moves to `{v: 2, open: {nav, files, assistant,
  console}, h?, w?, vert?}` under the same `layout` key, where `h` is the
  assistant and work group, `w` the files and center group (`{files,
  center}`), `vert` as before.
  A `v: 1` value is migrated, not dropped: `left` becomes `files`, the
  navigation opens, `assistant`, `console` and `vert` are kept, and `h` is
  dropped, since its panel ids changed. Folded panels keep no sizes, as in
  5.1. A value from a newer version is still read as the defaults and never
  overwritten.
- **Telemetry.** `layout_panel_toggled`'s `panel` becomes `nav | files |
  assistant | console` (`left` is gone: the files column is what it named).
  The navigation sends `nav_item_opened {item: home | new-project |
  tutorials | programs}` (prefix `nav`) when a user picks an item.

Kept: every id, `aria-label` and test id (`flow-console-drawer-body`,
`flow-left-tab-*`, `flow-stage-*`, `#tabs`, `#root-dir`, "Collapse/Expand
assistant", "Console", "New file"). `left-panel-toggle.e2e` moves to ⌘E and
the files column; a new e2e covers ⌘B on the navigation.

## Menus, dialogs, tooltips and toasts (5.6)

Decided with Slava on 2026-10-13 (HOO-2061). The first element move of 5.2;
the account footer, project list, New project and Settings (HOO-2068 to
HOO-2071) build on it. One PR.

- **The registry first.** `dialog`, `dropdown-menu`, `context-menu`,
  `popover`, `hover-card`, `drawer` and `sonner` exist as files in
  `design-system/src/components/ui/` but not as registry items; they are
  added to `registry.json` and installed with `yarn ds-add`. `sonner` takes
  its theme from our tokens instead of `next-themes`, which client-v2 does
  not have; that edit is made in the design system.
- **The four menus use the stock parts directly**: the editor tab's and the
  explorer's context menus, and the wallet's two dropdowns (only their menus;
  the rest of the wallet is HOO-2074). An item's label is `MenuItemText` from
  Menu extras, its key hint the stock `*Shortcut`; the other Menu extras
  parts (a line under a name, a note, a fold) wait for a menu that needs
  them. No wrapper of ours. `components/Menu` is deleted.
- **Drawer is installed, not used yet.** None of the four menus is reached on
  a phone today (two open on right-click, the wallet moves in HOO-2074). The
  phone Drawer arrives with the first phone menu (HOO-2069/HOO-2070) or in 5.7.
- **Tooltip.** Its call sites move to the stock `Tooltip`, one
  `TooltipProvider` for the app with a 500 ms delay; `help` becomes
  `HelpTip`. `components/Tooltip` and `components/Popover` (used only by
  Tooltip) are deleted. The theme's `tooltip` section stays: `Settings`,
  `Build`, `Deploy` and `Stepper` read `tooltip.bg` for things that are not
  tooltips; it goes with the global reset (5.24).
- **Dialogs keep `PgView.setModal`.** The stack, the promise of an answer and
  `onDidOpenModal` (which closes the navigation's Sheet) stay in `PgView`;
  only the renderer changes. The 21 dialog bodies keep the old `<Modal>`
  props (`title`, `buttonProps` with `onSubmit`/`noCloseOnSubmit`) on
  `ModalFrame`, so each changes an import and gains a `name`; every dialog
  has the stock header's Close, so `closeButton` goes. A submit that throws
  shows its message in the frame and keeps it open, as today; one that throws
  `SubmitCancelled` (the user backed out of a dialog it opened) stays open
  and quiet. While a submit runs the dialog cannot be dismissed. Enter
  submits from anywhere in the dialog except a control that owns Enter.
  `size="wide"` is the gallery's. A dialog that throws while rendering is
  reported and closed with no answer. Each stacked dialog's own answer
  (`closeModal` resolves every pending `setModal`) is HOO-2091.
- **Toasts keep `PgView.setToast` and `closeToast`.** The options become our
  own type, `{name, id?, duration?: number | "persistent"}`, instead of
  react-toastify's `ToastOptions`; `id` replaces `toastId`, `"persistent"`
  replaces `autoClose: false`. Sonner sits bottom left, offset past the rail,
  above the dialogs and the Sheets (the legacy layer sat under the modal
  backdrop); a press on a toast is not "outside" a dialog or a panel. A toast
  that throws while rendering is reported and closed. react-toastify and its
  overrides in `themes/palette.ts` go.
- **Names are explicit.** Component names do not survive minification, so
  every dialog's `ModalFrame` and every `setToast` call declares a kebab-case
  `name` for telemetry.

```
widgets/overlays/
  ui/ModalHost.tsx        connected: the PgView.setModal stack in the stock
                          Modal; Escape and a click outside close it
  ui/BaseModalFrame.tsx   markup only: header, error, body, Cancel/submit
  ui/ModalFrame.tsx       connected: submit, the error, PgView.closeModal
  ui/ModalPages.tsx       a dialog of several pages, reported once
  ui/modal-layer.ts       contexts: top of the stack, dismiss block, report
  ui/ToastHost.tsx        connected: PgView.setToast/closeToast on Sonner
  model/telemetry.ts      the `overlay_*` events
shared/lib/toast-layer.ts the toaster's selector, read by the dialogs and
                          `useOnClickOutside`
```

**Telemetry** (prefix `overlay`): `overlay_modal_opened {name}` when a frame
mounts, `overlay_modal_submit_failed {name}` when a submit throws,
`overlay_toast_shown {name}` when a toast shows or replaces one with the same
id. Logs go through `overlays:modal-host` (a dialog that crashed),
`overlays:modal-frame` (a submit that failed), `overlays:toast-host` (a toast
that crashed or was sent wrong) and `explorer:context-menu` (a menu action
that failed); failures are logged with `report: true`.

Kept: every `aria-label` and test id inside the dialogs and menus, the key
hints, Escape, the 500 ms tooltip delay, and the phone dialog as a page of
its own (the stock `Modal` does it below `md`).

## Controls (5.5)

The controls the user picks with come from the design system, app-wide,
before the screen tickets that place them (HOO-2068 New project, HOO-2071
Settings). Installed: `stepper`, `select`, `native-select`, `radio-group`,
`field` (`segmented` was already there). The last four have sources in
`design-system/src/components/ui` and no registry item, so this task registers
them, as `feedback-widget` did for its parts. `toggle-group` and `input-group`
wait for their first use (a multi-toggle, a field with an addon); none exists
yet.

| Today | Becomes | Where |
|---|---|---|
| `views/flow/header/Stepper.tsx`, styled | `Stepper`: the gradient thumb, statuses, the lesson target, `compact` | Same file, same props (`state`, `onSelect`, `target`) |
| `components/Select` (react-select) | `Select`: option groups, a tick on the chosen one | `app/Panels/Side/Left/Settings.tsx`, `Connect.tsx` (model, effort), `Workspaces.tsx` |
| styled `<select>` | `NativeSelect` | `stages/Interact.tsx` (deployment) |
| network chips, a hand-rolled roving tabindex | `Segmented`, `chips` | `settings/GearSidebar.tsx` |
| framework buttons | `Segmented`, `gradient` | `gallery/StartFromScratch.tsx` |
| model presets, `aria-pressed` | `Segmented`, `chips` | `Connect.tsx` |
| provider cards, `aria-pressed` | `RadioGroup` (each card has a description and can be disabled) | `Connect.tsx` |
| model and key fields | `Field`, `FieldLabel`, `Input` | `Connect.tsx` |

`react-select`, `components/Select` and the theme's `components.select`
(once nothing reads it) are removed.

**The stepper keeps its file and its props**, so the layout task that moves
it into the stage column (5.2, HOO-2055) moves an import, not a component.
It keeps `flow-stage-tab-*`, `aria-controls="flow-stage-panel-*"` and its own
`aria-label` ("Build: failed, 3 errors, current lesson target"), which
override the design system's. `upcoming` and `active` map to `idle`: the
thumb shows the current stage. The connectors between stages go; the thumb
replaces them, as in the prototype.

**Radix gives a single-choice toggle group the radio roles.** The network
group keeps `role="radiogroup"` and `aria-label="Network"`. In `Connect`,
`aria-pressed` buttons become radios with the same names, which states
"one of a few" more precisely.

**In `Segmented`, selection follows focus on the arrow keys only.** A radio
group's arrow keys move the choice, so the design system's `Segmented` picks
the item an arrow, Home, End, PageUp or PageDown key moves focus to (the
keys Radix's roving focus moves on). Tab, Shift+Tab, a click's
focus and a programmatic `.focus()` pick nothing by themselves: Radix keeps
the last focused item as the group's tab stop, not the checked one, so
picking on any focus switched the network on a Shift+Tab. A group with
`rovingFocus={false}` (the merge view's pane tabs) never follows focus.
In the backend list (a `RadioGroup`) the arrow keys walk the providers
without folding the list; only a click folds it.

**A stored setting value no option has shows an empty trigger.** On a
setting without a Custom option, `Select` has nothing to show for it, where
react-select showed the last option. A setting with Custom shows "Custom".

**Not in this task:**

- `components/Input` with `validator` and `error` (14 uses): the message
  above the field and the success edge are the Field validator, planned in
  the design system and ticketed separately.
- The gallery's and the left panel's tabs: they are tabs with panels
  (`role="tab"`, `flow-left-tab-*`), which `Segmented` would turn into
  radios. The gallery is restyled by HOO-2068.
- Checkbox and Switch: the leaves task (HOO-2058).

## Buttons (5.4)

Decided with Slava on 2026-10-14 (HOO-2059). Every button comes from the
design system: `Button`, `BrandButton`, `AsyncButton` and `CopyButton`, all
installed with `yarn ds-add`. `HelpTip` arrived with 5.6 and is not touched
here. One PR, stacked on 5.6's.

| Was (legacy) | Becomes |
|---|---|
| `GradientButton`, the one call to action of a view | `BrandButton`, `ring` |
| `kind="primary"` | `Button`, `default`; `BrandButton` `accent` where it is a call to action and the ring would be too loud |
| `secondary`, `outline`, `primary-outline`, `secondary-outline` | `Button`, `secondary` or `outline` |
| `transparent`, `no-border`, `primary-transparent`, `secondary-transparent` | `Button`, `ghost` |
| `kind="icon"` | `Button`, `ghost`, `size="icon-sm"` |
| `kind="error"` | `Button`, `destructive` |
| `Button.Copy` | `CopyButton` |
| `Button.Export` | `Button asChild` around the `<a download>` |
| `Button.Import` | `components/ImportButton`, the same hidden file input on `Button` |
| `leftIcon`, `rightIcon` | children with `data-icon="inline-start"` / `"inline-end"` |
| `color`, `bg`, `hoverColor`, `fontWeight`, `fullWidth`, `size` | a variant, or a class |

The brand buttons: the Build stage's four ("Continue to Deploy" twice and
"Fix with assistant" twice; its Build, Retry build and Rebuild are
`AsyncButton`s), Deploy, the assistant's "Allow", Connect and Start from
scratch.

**Waiting is opted into.** The legacy `Button` disabled itself and spun on
every click (icon buttons excepted), awaiting the handler's result.
`AsyncButton` does the same for a handler that returns a promise or any
thenable, so it goes only where the handler returns one or the caller passes
`loading` (the sidebar's Build, the IDL's init/upgrade, the wallet's Send
with `loadingText="Sending..."`). `loading` adds to the button's own wait and
never replaces it, so the sidebar's Deploy does not return its deploy: a
second press while it runs pauses it. Every other button is a plain `Button`.

**A click that fails is logged.** The design system's `AsyncButton` awaited
the promise in a `try`/`finally`, so a rejection escaped as an unhandled
rejection; with `CopyButton`, a refused `writeText` was an unhandled
rejection too. Both gain
`onError(error)`, changed in `design-system/` and reinstalled. Without it,
`AsyncButton` rethrows as before and `CopyButton` shows no "Copied". In
client-v2 every `AsyncButton` and `CopyButton` passes `reportButtonFailure`,
which logs through `createLogger("ui:button")` without `report: true`. It
replaces the legacy `Button`'s `console.error`, which only wrote to the
console: many of these failures are caused by the user (a cancelled deploy, a
wallet refusal) or already printed by the terminal command, so they must not
page the team. What reaches Sentry is HOO-1800's call. Decided with Slava
2026-10-14.

Removed: `components/Button`, `components/GradientButton`, and the theme's
`components.button` override type. `client-v2/CLAUDE.md` loses its paragraph
on `GradientButton`; comments that cite it (`views/flow/tokens.ts`, the
stepper) cite `BrandButton`.

Kept: every id, `aria-label` and test id on a button. The design system's
`data-slot` names (`button`, `brand-button`, `copy-button`) come with it.

## Leaf elements (5.3)

The small elements a screen is built from come from the design system,
app-wide, before the screen tickets that restyle around them. Leaves first,
as the design system's migration map orders them
(`design-system/src/ds/migration.tsx`): each swap deletes one
styled-component.

| Today | Becomes | Where |
|---|---|---|
| `components/Text` (a callout) | `Callout`, with a lucide icon per kind | 26 call sites: modals, the wallet, the explorer, Interact, the not-found page, the gallery lists |
| `components/Tag` (level, framework, languages) | `Tag`, `levelVariant` for the level colours; the framework image and `LangIcon` stay inside it | tutorial and program cards, tutorial details |
| `components/Checkbox` | `Checkbox` and `Label`; a boolean setting is a toggle, so it takes `Switch` | the assistant's skills, the build flags; the settings panel |
| `components/Foldable` | `Collapsible`, a chevron that turns 90° | settings groups, the wallet's Send, Interact's Args, Accounts and Result |
| `components/ProgressBar` | nothing: no call site uses it | removed |
| hand-built chips, counts, empty states, key hints, status dots, the avatar, the logo mark | `Badge`, `Tag`, `Empty`, `Kbd`, `StatusDot`, `Avatar`, `Logo` | `views/flow` and the assistant panel |

**Installed as used.** `yarn ds-add` installs only what a call site in this
task uses. The stock parts (badge, checkbox, switch, collapsible, kbd, empty and
avatar) have sources in `design-system/src/components/ui` and no
registry item, so this task registers them, as 5.5 did. `Progress` and
`ScrollArea` wait for their first use.

**Behaviour the swap adds.**

- A callout of kind error or warning is `role="alert"`; the others are
  `role="note"`. The legacy `Text` had no role.
- A `Collapsible` trigger is a `<button>` with `aria-expanded`. The legacy
  `Foldable` was a clickable `<div>`, out of the tab order.
- A checkbox is a Radix checkbox with its `Label`; a click on the label
  toggles it, as the legacy `<label><input>` did.

**The theme loses** `components.text` and `components.progressbar`, which only
the removed components read: their types in `utils/theme/interface.ts`
(with `OverridableComponent`, which nothing else used), their defaults in
`utils/theme/theme.ts` and the progress bar's accent in `themes/palette.ts`
are gone.

**Unreachable code is swapped, not deleted.** The legacy sidebar pages'
components (`views/sidebar/build-deploy`, `tutorials` and `programs`),
`components/FilterGroups`, the explorer's `Share` modal and
`components/FilePicker` are reached by nothing, since nothing calls a sidebar
page's `importComponent`. They take the mechanical swap so the legacy
components can go; deleting them belongs to the screens that replace them
(HOO-2064, HOO-2066, HOO-1760).

**Files under the other element tasks were swapped last.** Call sites in
files that 5.2, 5.4, 5.5 and 5.6 change were swapped after those landed, by a
rebase, so this task merges after them. The legacy `Text`, `Tag`, `Checkbox`
and `Foldable` components are deleted, and no import of them remains. Ids,
`aria-label`s and the texts the e2e reads stay.

## Risks / Trade-offs

- **The upgrade is late for the freeze.** The design system's v0 is due Nov
  11 too, so Breakpoint screens are built on a library still being finished.
  Breakpoint is conditional while deadlines are reworked; which steps of
  section 5 make the demo is tentative, and the frame (5.2) comes first in
  any cut.
- **styled-components types.** If version 5's types cannot live with React
  19's, the upgrade grows to version 6 across 154 files. The spike says they
  can.
- **Removing themes** is visible to users who picked one. Dark fallback,
  said once.
- **Two sets of primitives** if Base UI stays for the combobox.
- **The read-only editor breakpoint** is settled (2026-10-09): 600 px. See
  "The layout shell".
