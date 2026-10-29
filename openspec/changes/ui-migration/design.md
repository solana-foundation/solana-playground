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
- Stack Sans loads from Google Fonts: `client-v2/src/index.css` copies the
  import of the system's `inject.css`, and `scripts/fonts.build-test.mjs`
  checks the build against it. Manrope, the tokens' named fallback, loads
  only on the system's own site (`design-system/src/index.css`), never in
  `client-v2`. The app sends `Cross-Origin-Embedder-Policy: require-corp`,
  which does not block the fonts: both Google Fonts hosts answer
  `Cross-Origin-Resource-Policy: cross-origin` (checked 2026-10-22). If they
  stop, the page falls back to system fonts and the console shows a COEP
  error. Nothing self-hosts Stack Sans.

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
  token files, `shared/lib/css-color`, the third-party logo colours in
  `languages/`, and `app/favicon.svg`, which the browser draws outside the
  page, where no token reaches (HOO-2241). Named colours (`white`, `red`) are not caught: the words are
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
- cssnano runs without its `calc` step (5.18, `craco.config.js`):
  postcss-calc cannot parse a `calc()` inside a `var()` fallback, which
  shadcn's `scroll-fade-*` utilities emit, and CI fails the build on its
  warning.

## The `@/` alias

`@/*` is declared once, in `client-v2/tsconfig.json` `paths`. Webpack reads
it through `resolve.tsconfig` (set in `craco.config.js`), vitest through
`resolve.tsconfigPaths`, and ESLint through its typescript resolver.
react-scripts 5 runs `verifyTypeScriptSetup`, which would strip `paths`, only
from `init`, so `paths` survives start and build.

Because webpack and vitest resolve runtime imports through `paths`, every
entry there names a runtime file. A package subpath that needs a type-only
mapping (`moduleResolution: "node"` ignores package `exports`) is declared in
`src/types/package-exports.d.ts` instead.

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
not import the widget. (5.7 replaced this: see "The phone (5.7)": Monaco reads no viewport and announces no
blocked edit, the widths are 1024 and 720 (768 since HOO-2208). The hook stays in `shared/`
because several slices read it (the layout shell, the overlays' toast host,
the navigation, the Flow views), and a widget may not import another
widget's code.)

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

**Width.** `LAYOUT_BREAKPOINTS = { compact: 1024, left: 768, phone: 600 }` (5.1; 5.7 replaced this: see "The phone (5.7)").
`left` is not a viewport class: it names the stock Sidebar's own threshold,
and a unit test holds it to `use-mobile`.

| Width | Left | Assistant | Editor |
|---|---|---|---|
| wide >=1024 | Sidebar or rail | resizable panel | edits |
| compact 600-1023 (5.1; 5.7 replaced this: see "The phone (5.7)") | rail from 768; the stock Sheet below 768 | right Sheet; "Expand assistant" on the right edge, Ctrl+R | edits |
| phone <600 (5.1; 5.7 replaced this: see "The phone (5.7)") | the stock Sheet | full-width Sheet | read-only |

5.7 replaces the phone row: below 720 (768 since HOO-2208) the app is three pages and the editor
edits (see "The phone (5.7)").

The stock Sidebar turned into its Sheet at 768 px (`use-mobile`), so there
were three thresholds, accepted rather than editing `shared/`. HOO-2208 moves
`phone` to the Sidebar's 768, so there are two (see "Width" in 5.2). On a phone
(5.1; 5.7 replaced this: see "The phone (5.7)") Monaco gets `readOnly`, and the message that editing works from 600 px is
shown through Monaco's message controller (0.37 has no `readOnlyMessage`
option); chat works at every width. Explorer actions are not made read-only.
The header is gone since 5.2; its compact steps, `STEPPER_COMPACT_AT` (80 rem)
and `CHIPS_COMPACT_AT` (72 rem), are kept as they are until 5.10 and 5.15
restyle the stage bar and the footer. The phone's own structure is 5.7
(HOO-2062).

**Telemetry** (prefix `layout`, `model/telemetry.ts`; `layout_readonly_edit_blocked`
below is 5.7 replaced this: see "The phone (5.7)": the event is no longer sent): `layout_panel_toggled
{panel, open, via: button | key | drag | auto}`, `via: drag` when dragging an
edge folded or unfolded it, `via: auto` when a deploy or "Fix with assistant"
opened it; `layout_viewport {viewport}` once per load;
`layout_readonly_edit_blocked` once per page load, from Monaco's
`onDidAttemptReadOnlyEdit` (5.1 only); `layout_restore_failed {reason: corrupt | version
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

(5.25 restyles this frame: no inset, gutters or cards, a bar over each
column, and the assistant and files columns hide to nothing instead of
folding to a strip and a rail. See "Frame chrome (5.25)".)

- **The header is removed.** The logo and `ProjectSwitcher` go to the top of
  the navigation, `StatusChips` (cluster, wallet, settings) to its footer, the
  `Stepper` and its Ctrl+1..4 keys to the stage bar. In the rail the switcher
  and the chips are hidden; the four items keep their icons, with a tooltip.
  The rail's footer holds two icons, as the prototype draws it: the
  cluster's dot, coloured by its status like the chip's, which opens the
  settings on the cluster, and the account (the avatar, or a user icon),
  which unfolds the navigation (5.15: it opens the account menu instead). The
  feedback trigger is not on the rail; the
  prototype keeps "Report a bug" in the account's menu. Between 768 and 1024
  the rail is where the navigation starts, so without its footer a cluster
  that is down would show nowhere.
  The sync banner stays above everything, full width.
- **The stage bar spans the files column and the stage**, as the prototype
  draws it, not the files column alone.
- **The navigation is a widget, `widgets/app-nav`**: `BaseAppNav` built from
  the installed `Sidebar*` parts and `lucide-react` icons, slots for the
  switcher and the footer; `AppNav` connected. New project opens the
  existing gallery (`NewWorkspaceModal`) on its default tab (the nav no
  longer passes `initialTab`), which 5.13 restyles as New project (see
  "New project (5.13)"). Tutorials and Programs open
  their pages; see "Tutorials and Programs pages (5.9)". Home's item shows
  Home; see "Home from an open project (5.28)". _Rejected:_
  hiding Home until 5.8; disabled items saying "soon".
- **Keys.** ⌘B folds the navigation (the stock Sidebar's own key), ⌘E the
  files column, Ctrl+R the assistant, Ctrl+J the console. The files toggle
  keeps "Collapse project panel" / "Expand project panel" and the rail's "New
  file"; its hint reads ⌘E. Below 768 ⌘E opens and closes the pager's Files
  Sheet. On macOS Monaco keeps ⌘E (find with selection)
  while the editor has focus, so the shell's ⌘E works outside the editor
  there; on Windows and Linux Ctrl+E folds the column from the editor too.
  _Rejected:_ ⌘B staying on the files column, leaving the navigation to its
  button alone.
- **Width.** From `LAYOUT_BREAKPOINTS.compact` (1024) every column is in
  place. Between `phone` (768) and 1024 the navigation starts as a rail on
  every load; ⌘B or its button unfold it for the visit, and that is not
  saved. The files column stays, and the assistant is the right Sheet, as in
  5.1. There is no left Sheet anywhere the frame shows: `phone` is the stock
  Sidebar's own 768 (its `use-mobile` and its `md:` classes, installed from
  the design system and not edited), so below it the pager shows instead,
  with the navigation on its menu page apart from the files, as on the
  prototype's phone (HOO-2208; Slava 2026-10-22: one value every layout rule
  reads, until the designers settle the breakpoints). _Rejected:_ the
  navigation and the files column sharing the stock Sidebar's Sheet from 720
  to 767, as 5.2 first had it, which left the navigation 0 px high under the
  files column; two left Sheets there, which the prototype does not have; the
  prototype's 720, which needs the design system's Sidebar edited (Slava:
  not before the breakpoints are settled).
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
  `onDidOpenModal` (which closes the phone's Files Sheet) stay in `PgView`;
  only the renderer changes. The 21 dialog bodies keep the old `<Modal>`
  props (`title`, `buttonProps` with `onSubmit`/`noCloseOnSubmit`) on
  `ModalFrame`, so each changes an import and gains a `name`; every dialog
  has the stock header's Close, so `closeButton` goes. A submit that throws
  shows its message in the frame and keeps it open, as today; one that throws
  `SubmitCancelled` (the user backed out of a dialog it opened) stays open
  and quiet. While a submit runs the dialog cannot be dismissed. Enter
  submits from anywhere in the dialog except a control that owns Enter.
  `size="wide"` is the gallery's. The submit's `variant` is the stock
  `Button`'s `default` or `destructive`, or `brand`, the ring `BrandButton`,
  for a dialog whose submit is its view's one call to action (Connect a
  model, 5.17). A dialog that throws while rendering is
  reported (`overlays:modal-host`, `report: true`), told to the user by a
  `modal-failed` toast ("Could not open. Try again."), and closed with no
  answer. `setModal` never rejects, so `ModalHost`'s boundary is the one
  place that can tell whoever opened the dialog (5.8). Each stacked
  dialog's own answer (`closeModal` resolves every pending `setModal`) is
  HOO-2091.
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
"Fix with assistant" twice; its Build, Try again and Rebuild are
`AsyncButton`s), Deploy, the assistant's "Allow", Connect and Start from
scratch. 5.21 adds the tutorial page's START and CONTINUE, after the
prototype; its COMPLETED stays a ghost `AsyncButton`.

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
2026-10-14. 5.27 adds what the user sees ("Failed clicks (5.27)").

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

## The phone (5.7)

Decided with Slava on 2026-10-14 (HOO-2062). Below
`LAYOUT_BREAKPOINTS.phone` the app is the prototype's three pages, and the
editor edits on a phone; 5.1's read-only editor is gone. The value moves
from 600 to 720 px, the prototype's (768 since HOO-2208, the stock Sidebar's), while the customer's sheet says 1024:
it is still being confirmed with the customer, so it stays the one constant
every phone rule reads.

```
LayoutShell
├─ BaseLayoutShell owns the outlets: stage, console, rendered once, through portals
├─ >= phone: the four-column frame (5.2), unchanged
└─ <  phone: BasePhonePager (scroll-snap, three full-width pages)
   ├─ menu     the navigation, full width (AppNav and its session footer)
   ├─ work     bar: Menu, project name, Chat | Code, Preview
   │           Code: a file picker over the stage outlet (the Write stage)
   │           Chat: the assistant
   └─ preview  bar: Back to the code, the StageBar
               the stage outlet (Build, Deploy or Interact) over the
               console outlet
```

- **Widths.** Below `phone` the pager; from it to 1023 the layout is 5.2's:
  the navigation starts as a rail and the assistant is the right Sheet.
  `phone` was 720 here and is 768 since HOO-2208, the stock Sidebar's own
  line, so the frame never holds the Sidebar's Sheet.
- **The pages** are one horizontal scroll container with mandatory snap, so
  a swipe moves between them and the bars' buttons scroll to a page. Each
  page has a 60 px bar (`h-phone-bar`). A load lands on Work, showing Code.
  The page and the Chat | Code choice are the visit's and are not saved: the
  phone writes nothing to the `layout` key, so a phone visit leaves a wide
  window's layout as it was.
- **Code and Preview share the stage.** The stage router shows one stage at
  a time and `Write` (upstream's `Primary`) must never unmount, so there is
  one stage, not two: Code shows it at `write`; Preview shows the last stage
  that was not `write`, `build` the first time. Moving to Work or Preview sets
  `PgFlow.stage` (Work: `write`; Preview: the last stage that was not
  `write`); the Menu sets none. A stage set elsewhere (the StageBar's Write tab,
  Ctrl+1..4) scrolls the pager to the page that shows it (`via: auto`), so
  no page is left without its stage.
- **The stage and the console do not remount across `phone`.** They are rendered
  once, through `createPortal` into DOM nodes the shell owns; the frame and
  the pager each place those nodes where they need them. Crossing it
  (a rotation) keeps Monaco, the open file and the terminal's session. What
  does remount, because the pager replaces the frame's tree: the assistant
  (as it already does between its panel and its Sheet), the navigation and
  `LeftPanel`. Their state lives in stores (the assistant's thread, the
  explorer), so nothing is lost but scroll positions and uncommitted input.
- **Files.** The picker on Code ("Files, <file> open") opens a full-height
  Sheet titled Files holding `LeftPanel` as it is; opening a file closes it.
  ⌘E opens and closes it on a phone.
- **The navigation's `closeSheet`** has no Sheet to close on the Menu page;
  there it moves to Work, so settings opened from the footer are seen.
  `FeedbackHost` stays above the frame, so a draft survives the move between
  pages and across `phone`.
- **The assistant.** Chat shows it. `PgAssistant.onDidRequestPrompt` ("Fix
  with assistant") moves to Work and shows Chat; Ctrl+R switches Chat and
  Code.
- **The read-only editor is removed.** `components/Editor/Monaco/read-only.ts`
  goes whole (`applyReadOnly`, `READ_ONLY_MESSAGE`, `executeProductEdits`),
  with `PgEditor.events.READ_ONLY_EDIT` and `layout_readonly_edit_blocked`.
  The product's own edits call `editor.executeEdits` again, as before 5.1.
  The format sites ignore its result: `false` cannot happen without a
  read-only editor. The program id site keeps a logged guard (`report:
  true`), because a refused edit there would leave a stale `declare_id!` and
  fail silently at deploy. The two e2e that guarded the read-only
  editor go; the phone scenario now edits a file.
- **Telemetry** (prefix `layout`): `layout_page_shown {page: menu | work |
  preview, via: swipe | button | key | auto}` when a page comes into view
  (`key`: Ctrl+R from another page; `auto`: the product moved it, as "Fix
  with assistant" does, or as a stage set elsewhere does, which includes
  crossing into the phone width with the stage off `write`), not on load;
  `layout_work_view {view: chat | code, via: button | key | auto}` when Work
  switches. `layout_viewport`'s `phone` now means below `LAYOUT_BREAKPOINTS.phone`
  (768 since HOO-2208).

Kept: every id, `aria-label` and test id of the pieces inside the pages. The
pager's own controls take the prototype's names: "Menu", "Close the menu",
"Preview the build", "Back to the code", "Files, <file> open", and the
"Show" radio group holding Chat and Code.

## Build and Deploy stages (5.11)

Decided with Slava on 2026-10-15 (HOO-2066). The two stages are drawn with
the design system's `StageEmpty`, `Diagnostic` and `DropZone` (installed with
`yarn ds-add`), the buttons of 5.4 and the prototype's Deploy result block.

**Build** shows one of five surfaces, chosen by a pure `buildSurface()` in
`views/flow/stages/build-surface.ts` from the last settled build status and
the workspace's own report:

| Surface | When | Shows |
|---|---|---|
| `empty` | no build yet, or the first one running | "Nothing built yet" / "Building...", Build |
| `unreached` | a build settled in this session with no report from the compiler | Spec 08 BUILD-04: "Build did not start", Try again; the build server and the raw error behind Show details |
| `restored` | a verdict kept from before a reload, and no build settled since (a rebuild in flight keeps it) | "Built earlier" / "Last build failed", Build |
| `succeeded` | the report has no error | "Build succeeded", Continue to Deploy, Download IDL, Export project |
| `failed` | the report has errors | one `Diagnostic` per error, the compiler's output behind a toggle, Rebuild |

A diagnostic carries the rustc code, the plain explanation from `humanize`,
and the source lines around the fault read from the explorer, the faulty one
marked with rustc's label (the error's title when rustc gave none); without the
file or the line it shows rustc's own excerpt. Output the parser cannot split
becomes one "Unparsed compiler error" card, and the count falls back to the
stepper's, or is left out when neither counted any. "Fix with assistant" sends
the error to the assistant; it is the brand button on the first diagnostic
only.

**Deploy** is one `StageEmpty`, titled "Nothing deployed yet" until the
project's first deployment and "Deploy" after it, when it gains the Deploy
result block: a status line, the program id with a `CopyButton`, the
transaction, upgradability, and, while the program can be upgraded, its
authority and size, the time, then Interact (outline) and the Explorer links.
It reads the project's deployments when it opens, since the stage router
remounts it on every switch.
The history is a plain list: `Table` is not in the registry, and one list does
not justify registering it. The IDL is loaded through a `DropZone`, which takes
a dragged file or a picked one; a file that is not an Anchor IDL is refused and
logged as a warning, since it is the user's input and not a fault, while a
failure after the file was accepted is ours and is reported. Interact's
toolbar keeps a compact "Load IDL file" button (`IdlActions mode="button"`)
until its own screen moves (5.12).

**One accent action per screen.** Build, Try again and Rebuild stay
`AsyncButton`s (5.4), so the empty Build stage has no brand button; Continue to
Deploy, the first Fix with assistant and Deploy are the brand ones.

**Phone.** The action row is the last element of every surface. Below `md`
the surface is at least the stage's height and the row takes `mt-auto`, with
`StageEmptyActions`' own `sticky bottom-0`, so it sits at the foot whether the
content is short or long. The phone's Preview page (5.7, HOO-2062) hosts the
stage as it is.

**Structure.** By the UI move rule the stages import UI of ours
(`IdlActions`), so `BaseBuild` and `BaseDeploy` sit beside them and draw from
props alone; `Build` and `Deploy` stay the connected wrappers. Every
styled-component in the two stages and `IdlActions` is gone. No telemetry is
added: `views/` is a legacy root.

**Deleted:** `views/sidebar/build-deploy/Component`, which 5.3 swapped and
left for this task. Nothing calls the page's `importComponent`; the page's
registration (`build-deploy.ts`) stays, because `SIDEBAR` and the tutorials
still name it. Its default `importComponent` now points at the deleted folder;
whoever wires that sidebar path again builds the page anew.

Kept: `flow-stage-panel-*`, `flow-stage-tab-*` and the texts the e2e reads.

## Lessons (5.19)

Decided with Slava on 2026-10-16 (HOO-2076). Only placement and look change:
master-2.0's lesson logic (the ledger, verify) stays as it is; the entry's
page and the readiness line went with lesson-prototype-polish.

**Objective band** (`objective-band`, installed). Compact, over the editor in
the stage. Its look follows the original prototype (change
lesson-prototype-polish, HOO-2262): one row of "Step n of m", the gradient
meter, the objective and a check that shows how the step is checked, then
back and on (`ObjectiveNav`, "Previous step" and "Next step"), "Read the
page" and the step's one action: "Continue" on a step proved by reading,
else "I'm stuck" (the prototype's choice, Slava 2026-10-16). There is no
proving action and no readiness line (Slava, 2026-10-26); the stepper's dot
marks the stage that proves the step. At the path's end the band says
"done" and offers Browse gallery.

**Step rail** (`step-rail`, installed), in the files column behind a Steps |
Files `Segmented` that keeps the `flow-left-tab-*` ids. Marks map: proved and
attested to `done`, passed to `skipped`, the cursor to `current`, the rest to
`locked`, except the frontier once the cursor walked back from it: it is drawn
as not done but without the locked dimming, as master-2.0 never dimmed it
(review of PR #100). Each row keeps today's sub-line copy. Rows at legal positions stay
buttons that move there: master-2.0's navigation wins over the prototype's
"not a way to jump". "Skip this step" stays at the rail's foot, at the
frontier only.

**Reader.** The design system's `Dialog` with `modal={false}`, placed inside
the stage under the band, so it covers the editor and not the band. Esc closes
it and focus goes back to what opened it. Its head is the objective and
"Close the page"; it has no footer and opens only from "Read the page"
(lesson-prototype-polish).

**Phone** (below `LAYOUT_BREAKPOINTS.phone`). The band folds to one row ("n/m"
over the meter, the objective, a caret) that opens in place to show how the
step is checked; the band's actions sit in `LessonBar` at the foot of the
code (lesson-prototype-polish). The files row opens the Files sheet on Files,
with Steps one tap away.

**Structure.** As in 5.11: `BaseObjectiveBand`, `BaseStepRail` and
`BaseReader` sit beside the connected ones in `views/flow/lessons/` and draw
from props alone. No telemetry: `views/` is a legacy root. Every
styled-component in the three and in `LeftPanel`'s tab row is gone.

**Failures and the files a lesson keeps.** A page that fails to load, a lesson
record that fails to load or save, and a failed `program-info.json` write are
logged with `report: true` (pages are bundled, so a rejected page is a broken
chunk, not missing content). "Re-entering lands on the same step" failed on
new-face because lightning-fs saves its folder tree 500 ms after the last
write, so a reload lost a file just created; the same window lost
`program-info.json` and its keypair (Slava approved both fixes in this task,
2026-10-16). Both files go through `writeWorkspaceFile`
(`utils/explorer/workspace-file.ts`), beside `PgFs` in a legacy root because
the explorer is its only collaborator. It flushes the tree on a path's first
write only, since a flush rewrites the whole tree, and creates a missing
`.workspace/` without its parents, so a write that lands after its workspace
was deleted or renamed fails rather than bringing the folder back (review of
PR #100, 2026-10-20). `.tutorial.json` and the explorer's metadata writes have
the same window and are HOO-2137.

## The Interact stage (5.12)

Decided with Slava on 2026-10-20 (HOO-1676). The prototype draws only
Interact's toolbar and its empty state ("Nothing to call yet", Go to Deploy);
the form below them is composed from the design system's parts.

**Toolbar.** "Interact" with the mono meta line beside it, then Deployment as
the `NativeSelect` of 5.5 (mono) and `IdlActions mode="button"` ("Load IDL
file"). Its styled-components go.

**One `StageEmpty` replaces the six Callouts** (seven messages) the embedded
form showed before it could render. A pure `interactSurface()` in
`views/flow/stages/interact-surface.ts` picks the surface from the project
and program info, in the order the pre-5.12 form checked:

| Surface | When | Shows |
|---|---|---|
| `no-project` | no workspace open | "No project open" |
| `not-built` | no IDL, the project's own program | "Nothing to call yet", Go to Build |
| `no-idl` | no IDL, an imported program | "No IDL yet", Load IDL file |
| `no-program-id` | the program has no public key | "No program id", Go to Build (a build creates the key) |
| `bad-idl` | the IDL's `instructions` is not a list | an error `StageEmptyNotice`, the pre-5.12 text |
| `checking` | the first chain read has not settled | "Checking the program" |
| `unreachable` | the chain read failed | an error `StageEmptyNotice`, the pre-5.12 text |
| `not-deployed` | the program is not on the cluster | "Nothing to call yet", Go to Deploy |
| `ready` | everything above holds | the form |

`checking` is new: before 5.12 a read still in flight showed the connection
error until it settled. `PgProgramInfo.onChain` is `undefined` until its first
read and `null` after a failed one, which is how the two are told apart.

Go to Build and Go to Deploy are the stage's brand buttons and switch the
stepper (`PgFlow.setStage`). On a phone the action row sits at the foot, as
in 5.11 (`stage-layout.ts`). Its fade now starts from the part's own
`--background`, for Build and Deploy too: since the flush frame (5.25) that is
the stage column's colour below `md`, and 5.11's `--surface-panel` drew a band.

**The form** (`ready`). Instructions, Accounts and Events are headed
sections; each item is a `Collapsible` card (border, `rounded-xl`,
`bg-surface-panel`) instead of the striped rows. An input's label is its name
in mono with `Tag`s for the type (in its own case), `mut` and `signer`.
Fetched accounts and received events show as JSON in the design system's
`code-block`, titled "JSON", with a `CopyButton`; the JSON is not highlighted
any more, which the legacy `CodeBlock` did. Test, Fill
and Reset keep their variants and behaviour, left-aligned at the card's foot;
none is the brand button, since every instruction has a Test. Account inference, Fill and the submission flow do not
change.

**No `Table`** (Slava, 2026-10-20): the prototype shows none on this screen,
and what the stage returns is nested JSON, not rows.

**Structure.** The classic layout is gone (5.1), so the upstream `Test`
component has one user left, Interact, and is restyled in place under
`views/sidebar/test` rather than forked. `SearchBar`, the input with the
generator dropdown, stays: five places use it, among them the Tutorials and
Programs pages of 5.9, so its move is filed with Lead. The legacy
`components/CodeBlock` stays: `components/Markdown` still uses it. `BaseInteract` (toolbar and
surface, from props alone) sits beside `Interact`, the connected wrapper. No
telemetry is added: `views/` is a legacy root.

Kept: `flow-stage-panel-interact`, every id and `aria-label` the form uses,
and the texts "Load IDL file" and "Fetch All".

## The composer and Connect a model (5.17)

Decided with Slava on 2026-10-14 (HOO-2067). The assistant's head, its
composer and the Connect a model dialog take the prototype's shape; the
thread above the composer stays as it is until 5.18 (HOO-1794).

```
widgets/assistant
├─ AssistantHead: project name | More (⋮) | Widen | Hide
│    More: Sources and tools (S), Connect a model… (K),
│          Forget key (a keyed backend only),
│          Clear conversation (disabled until HOO-1741)
├─ (thread: today's Chat items, unchanged until 5.18)
├─ AssistantComposer (shared/ui/composer)
│    context chips | input | Add (not rendered until there is something to add)
│      | ModelMenu | EffortMenu? | Send ⇄ Stop
└─ (Connect a model: opened through the `openConnect` the app hands in)
```

- **Where the code goes.** A new widget slice, `src/widgets/assistant/`,
  with `BaseAssistantHead` (its connected side is the slice's `Assistant`,
  which also holds the thread and Sources views),
  `BaseAssistantComposer`/`AssistantComposer`, `BaseModelMenu` and
  `BaseEffortMenu`. The store (`PgAssistant`), the providers and the
  `Connect` form stay in `views/sidebar/assistant/` and are imported from
  there; they move with the thread or later. 5.18 adds the thread to the
  same slice.
- **Connect a model's frame sits outside the widget**, in the app layer: a
  widget may not import `widgets/overlays`, which holds `ModalFrame`, and the
  app layer may import both widgets. `ConnectDialog` and `openConnectDialog`
  live in `src/app/ConnectDialog/`, and `Flow` hands the opener to
  `Assistant` as `openConnect`, which passes it to `useTurn`. Not
  `views/`, as New project's frame (5.13) is: a legacy root takes no new UI
  and the boundary check does not read it. The widget's tests stand in for
  the dialog (Sergey's review of #35, 2026-10-22).
- **The head.** The project's name, then More, Widen and Hide. Hide is the
  shell's "Collapse assistant", label kept. Widen sizes the assistant panel
  to its maximum (560 px) and back; it is not saved in the layout, and it is
  not offered below `LAYOUT_BREAKPOINTS.compact`, where the assistant is a
  Sheet. The Chat and Sources tabs go: Sources and tools opens from More and
  closes with a back button. Clear conversation is shown disabled: clearing
  only what is rendered would come back from another device, and the
  cross-device clear is HOO-1741 (server half HOO-1742, signed-out HOO-1739).
  Forget key, the old chat header's button (#71), moves into More: shown only
  while a backend that needs a key is connected, disabled during a turn
  ("Finish this turn first"). Decided with Slava 2026-10-15.
- **One reconnect, on the panel's mount.** The connection a tab keeps in
  `sessionStorage` (#71) and the remembered default both reconnect from the
  panel's mount (`Assistant`, through `useTurn`), the kept key first, with one
  probe of `GET /api/agent` per page, asked again only after a failed one. `Connect` no longer probes or reconnects; nothing reconnects
  while Connect a model is open.
- **The composer is always there.** Nothing connected no longer swaps the
  composer for the picker:
  - the default backend configured on this deployment: the model button names
    it and the first send connects to it, then sends;
  - none configured: the model button reads "Connect a model" and opens the
    dialog, with the typed prompt kept in the composer; Send is disabled
    ("Connect a model to send") and Enter sends nothing (HOO-2241). A probe
    that failed is not "none configured": Send stays, and its send asks
    again. A suggestion or an outside request still opens the dialog.
  The thread restored before a backend is picked stays on screen above it.
- **The default backend needs a session.** Master's sign-in gate for the
  default backend (472ed30f6, the archived `default-backend-sign-in`) was
  built on the inline picker this task removed; landing new-face on master
  (HOO-2205) reconciled the two:
  - the form keeps the gate: signed out, the default is tagged "sign-in
    needed", reads "Sign in with GitHub to use it, or bring your own key
    below.", and the dialog's action is **Sign in with GitHub**, a failure
    shown in the form;
  - `useTurn` treats the default without a session (`PgAssistant.needsSignIn`)
    as nothing connected: a send opens Connect a model with the prompt kept,
    the first send connects the default only for a signed-in user, and the
    remembered default reconnects only once signed in, tried again when a
    user arrives. A send waits for the page's own session read
    (`PgSession.whenRead`) and never reads again: a read that found a session
    from another tab would reach the session effect as a sign-in and open the
    account's latest project under the prompt;
  - picking the default in the composer's model menu while signed out opens
    Connect a model on it rather than connecting;
  - on session end nothing opens; the next send asks. The store keeps
    `needsSignIn` and drops master's `keepBackend` refusal and its
    session-end `pickBackend`: both served the inline picker, and a refused
    `keepBackend` left the dialog's mark set, so it never opened again.
  _Rejected:_ opening the dialog at once when the session ends. Decided with
  Slava 2026-10-21.
- **The model is the real one.** The default backend's model comes from
  `GET /api/agent` (`model`, which it already returns), shown through a
  small table of display names (`z-ai/glm-5.3-flash:US` is "GLM 5.3 Flash");
  an id the table does not know is shown as it is. The prototype's
  "Opus 5.5" is sample data and is never shown for a backend that is not
  connected to it. A key-based backend shows its model id
  (`settings.model` or `endpoint.model`). While the deployment has not
  answered yet, the button is a quiet, disabled placeholder ("Checking the
  model…"), never "Connect a model" that then turns into the default's name.
- **The model menu.** The hosted default ("no key needed"), the models of
  the backends that have a model list, and "Connect with a key…". A model
  of the connected backend is switched in place; one of another backend
  opens the dialog on that backend.
- **Effort only where the backend takes it.** `ComposerEffort`'s ring runs
  over the backend's own ladder (`modelSettings.efforts`, five steps on
  Anthropic) and is shown only for a backend with `modelSettings`. The
  default backend's effort is the server's (`AGENT_REASONING_EFFORT`), so
  the composer shows none for it.
- **Switching in place keeps the thread.** A model or effort change on the
  same backend and key replaces the connection without `clear`
  (`PgAssistant.tune`); the next turn's provider is seeded from what is
  rendered, as a reopened thread is. A change of backend still starts a new
  conversation, as today.
- **Send turns to Stop** through the composer's `busy` and `onStop`. The
  input stays editable during a turn; Enter sends, Shift+Enter breaks the
  line, and an input method's Enter never sends. A prompt placed by "Fix with
  assistant" enables Send: the design system's `Composer` reads emptiness
  from `value` when the input is controlled (a fix made in
  `design-system/src/components/ui/composer.tsx` and reinstalled).
- **Connect a model is a dialog.** It opens through `PgView.setModal` in a
  `ModalFrame` (`name: "connect-model"`), as 5.6 has every dialog do, so it
  joins the modal stack, closes the phone's Files Sheet through
  `onDidOpenModal`, and reports `overlay_modal_opened`; below `md` the stock
  Modal makes it a page of its own with a sticky footer. It holds today's `Connect` form
  without its "Back to chat" and its own title, and opens from More (K),
  from the model menu, and from a Send with nothing to send to. It was built
  after 5.5 (#72) and the own-key change (#71) merged, since both edit
  `Connect.tsx`.
- **What survives.** "Message the assistant", the "Conversation" log, Send
  and Stop, "Expand assistant" and "Collapse assistant", and the form's
  ids and buttons ("Start", "Connect").
- **Telemetry.** Prefix `assistant`: `assistant_model_picked {provider,
  via}`, `assistant_effort_changed {effort}`, `assistant_connect_opened {via:
  menu | model | send}`, `assistant_turn_stopped`, and
  `assistant_default_probe_failed`, also logged with `report: true`. A probe
  answered 404 (no `/api/agent` on this deployment) is logged as a warning,
  not reported and not tracked, as #71 had it: it is expected off a full
  deployment; 5xx, network and body failures are reported. A connection made
  in the dialog counts as `assistant_model_picked` only when it differs from
  the one current when the dialog opened. Logs under `assistant:composer` and
  `assistant:connect`. Decided with Slava 2026-10-16.

## The assistant thread (5.18)

Decided with Slava on 2026-10-19 (HOO-1794). The thread above the composer
moves onto the design system at every width. The prototype draws no thread of
its own (its `#app` still runs today's styled one), so the design system's
catalogue ("Message and bubble", "Diff", "Marker") is the design.

```
widgets/assistant
├─ Thread / BaseThread   MessageScroller; its content is the log "Conversation"
│  ├─ empty    icon, "Ask about <project>", one line, suggestions as pills
│  ├─ user     Message align end, Bubble default (the accent), "You:" for a screen reader
│  ├─ reply    Message, Bubble ghost at full width, no avatar, "Assistant:"
│  │           for a screen reader; Markdown;
│  │           MessageFooter: Make this change | Build/Deploy | Skip this step
│  ├─ tool     Marker with a tick
│  ├─ error, notice   Callout, as today
│  ├─ working  Marker with a Spinner, status "Assistant is working"
│  └─ BaseApprovalCard   Diff parts: header (path and DiffStat, or "wants to
│                        run <name>"; a status Badge), content (the diff's
│                        lines, or `$ <name>` and its effect), footer
│                        (Apply/Reject, Allow/Deny, or the outcome)
└─ (AssistantComposer, 5.17)
```

- **Where the code goes.** `Thread` connects `PgAssistant`, the lesson and
  `turn.send`; `BaseThread`, `BaseThreadItem` and `BaseApprovalCard` take
  props only. `views/sidebar/assistant/Component/Chat.tsx` and `ChatItem.tsx`
  are deleted, with their tests moved. The store and `diff.ts` stay where
  they are.
- **Installed parts.** `message`, `message-scroller`, `bubble` and `marker`
  exist in `design-system/src/components/ui` but were never registry items;
  this task adds them to `design-system/registry.json` and installs them with
  `yarn ds-add`, with `@shadcn/react` (MessageScroller's primitive, React 19)
  from npm. `attachment` is not installed: a stored message carries no files,
  and the stored shape does not change here. Two parts were fixed in the
  design system on the way: the unused `tinted` bubble mixes `--primary`
  into `--background` with `color-mix` instead of `oklch(from …)`, which
  `check-colors` rejects as a colour literal, and `DiffLine` sets the code
  font itself, because the base layer gives every `data-slot` element the
  text font.
- **What does not change.** The stored transcript (`ChatItem`), how an
  approval is answered (`resolveApproval`), the outcome lines, and a restored
  card that was never answered, which reads "not applied -- the session ended
  before you answered" (HOO-1737, HOO-1820), and the notice that heads the
  log while the open thread could not be read (`PgAssistant.unsaved`,
  HOO-2109), drawn from state and never stored.
- **Small screens.** Below `md` the card's actions are one row of 44 px
  targets and a diff scrolls inside `min(15rem, 40dvh)`, so a pending card's
  question and its answer fit above the keyboard. The scroller follows new
  content only while the reader is at the end; once they scroll up by wheel,
  touch or keys it stays put and offers "Scroll to end". There is no scroll
  anchor, so a send made while scrolled up does not move the thread.
- **What survives.** The log "Conversation", "Assistant is working", "Make
  this change", "Write it for me", "Skip this step", Apply, Reject, Allow,
  Deny, and the status words, now in sentence case (Proposed, Applied,
  Declined, Not answered).
- **What changes.** The "YOU" and "ASSISTANT" headers become the bubbles'
  sides, with the speaker kept for a screen reader; the diff loses its
  line-number gutter, which the design system's `DiffLine` does not draw; the
  suggestions become the prototype's three, and "What's our current status
  and roadmap?" goes.
- **Telemetry.** Prefix `assistant`: `assistant_approval_answered {kind:
  patch | command, answer: allow | deny}`, `assistant_suggestion_picked`,
  `assistant_make_change_requested`. The thread logs nothing of its own: a
  send that fails before its turn starts is `useTurn`'s, through
  `reportButtonFailure`, and a failed "Skip this step" goes there too.

## The project list (5.14)

Decided with Slava on 2026-10-16 (HOO-2069). The prototype's "Projects"
group replaces the frame's `ProjectSwitcher`; the account footer beside it
is HOO-2070's (5.15), which keeps `SidebarFooter` and the `footer` /
`railFooter` slots.

```
AppNav
├─ SidebarHeader   logo, fold button (5.2)
├─ SidebarContent  Home, New project, Tutorials, Programs (5.2)
│                  projects slot → ProjectList (hidden on the rail)
│                  └─ "Projects": pinned first, then the rest; a started
│                     lesson is a row among them (lesson-prototype-polish)
└─ SidebarFooter   HOO-2070
```

- **Where it lives.** `widgets/app-nav`: `BaseProjectList` takes the
  entries (each with its `pinned` flag), the current name, the rename state
  and the callbacks, and is built from the installed `Sidebar*` parts,
  `DropdownMenu` with `DropdownMenuShortcut` and `Input`; `ProjectList`
  connects `PgExplorer`, `PgTutorial` and the pins.
  `BaseAppNav`'s `switcher` slot becomes `projects`, not rendered on the
  rail, which shows no projects in the prototype. `ProjectSwitcher.tsx` is
  deleted; `groupWorkspaces` becomes `listProjects` in
  `model/project-entries.ts`, which also orders pinned entries first.
- **It follows the explorer.** The list re-renders on `PgExplorer`'s
  create, rename, delete and switch events and a new
  `onDidChangeWorkspaceList` (no lesson progress since
  lesson-prototype-polish): the switcher
  re-read the list each time it opened, while the list stays mounted, and two
  changes reach the list with no other event, another tab's list taken by
  `refreshWorkspaces` and a rename sync makes unannounced. So a project
  synced from another device appears without a switch, and one renamed or
  deleted elsewhere does not linger. A rename field whose project went is
  dropped. On a phone the list is on the menu page, which renders `AppNav`
  (5.7).
- **A row.** A folder icon (a cap for a lesson) and the name; the current
  project is marked (`aria-current`, the accent on its icon); a pinned one
  shows a pin. "Actions for <name>" opens its menu, shown on hover and on
  focus. The menu, as the prototype draws it: Open `O`, Pin or Unpin `P` |
  Rename `R`, Duplicate `D`, Export as zip `E` | Delete `⌫`. A letter (or
  Backspace or Delete) runs its item while the menu is open, in place of
  Radix's typeahead, which would only move focus. A lesson's menu has no
  Rename, since a lesson is recognised by its workspace name, and no
  Duplicate.
- **Open** goes through `PgTutorial.open` for a lesson and
  `PgExplorer.switchWorkspace` for a project, as the switcher did.
- **Pins** are kept per device under one `localStorage` key, `nav.pins`: an
  array of workspace ids, so a rename keeps the pin. An id no workspace has
  any more is left out when the list draws, and removed from storage once
  the explorer has loaded its workspaces. A value that cannot be read, or
  storage the browser refuses, is no pins, logged. A pin is toggled against
  what storage holds, and another tab's change is taken from the `storage`
  event, so two tabs do not undo each other's pins. Syncing pins across
  devices is a ticket of its own (HOO-2121). _Rejected:_ pins in `/.config`
  through `PgFs` (an async read before the list can draw, for a few hundred
  bytes).
- **Rename** happens in the row: an `Input` named "Rename <name>". Enter,
  or a blur after a change, commits; Escape, or a blur with no change,
  cancels. The name is trimmed before it is checked. An invalid or taken
  name shows in place (`aria-invalid`) and keeps the field open, and so does
  a refusal from the explorer (the project went, or the name was taken
  meanwhile), unreported. One rename runs at a time. It calls
  `PgExplorer.renameWorkspace(newName, {from, announce: true})`, the path
  the rename modal takes, so sync uploads the new name.
- **Duplicate** reads the project's files from the store and creates
  `<name> copy` (then `<name> copy 2`, ...; a workspace name allows no
  parentheses) through `PgExplorer.createWorkspace`, which opens it. It
  leaves out `.workspace/`: `program-info.json` holds the program keypair,
  and a copy holding it would deploy over the original's program.
  _Rejected:_ copying the keypair. An edit made in the last 500 ms before a
  duplicate of the open project, still in the editor's autosave window, is
  not in the copy, as it is not in anything else that reads the store.
- **Export as zip** opens `ExportWorkspace`, already on the design system's
  `ModalFrame` since 5.6, fixed in place by the UI move rule rather than
  rebuilt in `app-nav`, which would have to import the `overlays` widget's
  `ModalFrame`; the list opens it through `PgView.setModal`, as it does
  `DeleteWorkspace`. It takes the workspace's `name`, and
  `PgFramework.exportWorkspace` takes it too, so any project exports, not
  only the open one. A conversion that fails exports as is, and the toast
  saying so is shown once that export has happened; a project of no known
  framework (`PgFramework.isUnknownFramework`) is noted, any other
  conversion failure is logged with `report: true`. An export that fails
  tells the user and logs with `report: true` (it was only logged, through
  `reportButtonFailure`).
- **Delete** opens `DeleteWorkspace`, which owns the confirmation, as from
  the switcher.
- **Telemetry** (prefix `nav`): `nav_project_action {action: open | pin |
  unpin | rename | duplicate | export | delete, via: click | key}` when an
  action starts (`rename` on commit; `export` and `delete` when their
  dialog opens, since the dialog owns what follows), and
  `nav_project_action_failed {action}` when the list's own part fails. A
  failure inside a dialog is the dialog's: `DeleteWorkspace`'s submit sends
  the overlays' `overlay_modal_submit_failed`, and `ExportWorkspace` tells
  the user and logs with `report: true`. The list does not hear of either,
  and making the legacy dialogs call back into it is not worth a second
  failure count. Logs go to `app-nav:projects`.

Kept: "Delete <name>" and "Rename <name>", the switcher's labels, now the
menu's items and the rename field. The e2e that went through the switcher's
trigger go through the list.

## Frame chrome (5.25)

Decided with Slava on 2026-10-16 (HOO-2122), from the frame comparison of
that day (prototype against `new-face` e4879af6, measured at 1440). 5.2 moved
the pieces into the frame unchanged; this task gives the frame the
prototype's own look. Nothing inside a column changes.

```
SidebarProvider (no padding)
├─ Sidebar → AppNav, 1 px right line
└─ SidebarInset → Group horizontal (id layout-horizontal)
   ├─ Panel assistant: AssistantHead (44 px, 5.17's) over the assistant;
   │                   hides to 0 px
   ├─ 1 px handle
   └─ Panel work
      ├─ StageBar (44 px): [project name when the assistant is hidden] ...
      │                    Files · Assistant · Documentation
      ├─ stage tabs (38 px): Write | Build | Deploy | Interact, full width
      └─ Group horizontal (id layout-work)
         ├─ Panel files: LeftPanel, no ⌘E strip; hides to 0 px
         ├─ 1 px handle
         └─ Panel center: stage | 1 px handle | console
```

- **Flush.** The shell's 8 px inset (`GAP` on the provider and the
  Sidebar), the `md:ml-2` gutter and the `w-2` transparent handles go. A
  handle is a 1 px line in `border` with its old hit area. The navigation
  draws its own right line again. The floating cards (`Center` and `Right`
  in `Flow`, `LeftPanel`'s wrapper, the console drawer's) lose their border
  and radius and sit on the page's background; the editor keeps its own.
  The sync banner keeps its gutter.
- **Bars.** Every bar is 44 px with a 1 px bottom line, as the navigation's
  head. Over the assistant it is 5.17's `AssistantHead` (the project's name,
  More, Widen or Narrow, and "Collapse assistant"), sized to the bar and not
  redrawn. Over the stage, `StageBar` holds the stage's toggles on the
  right: "Collapse project panel" / "Expand project panel" (⌘E; the files
  column's own strip goes), the assistant's toggle, and "Documentation"
  (solana.com/docs, a new tab). The assistant's toggle reads "Hide the
  assistant" while the assistant is open and "Expand assistant" while it is
  hidden, so the head's "Collapse assistant" stays the one button by that
  name. While the assistant is out of view (hidden on a wide window, its
  Sheet closed below 1024 px), the project's name shows at the bar's left.
- **Stage tabs.** The `Stepper` leaves the bar and becomes a 38 px row of
  its own under it, spanning the files column and the stage, its four
  segments sharing the width equally. Ctrl+1..4, the statuses, the lesson
  target and `flow-stage-tab-*` are kept.
- **Widths at 1440** are the prototype's: navigation 232, assistant 368,
  files 240, the editor the rest (600). The assistant's and the files
  column's defaults move from 348 and 232; their minimums and the
  assistant's maximum stay. The tablet's assistant Sheet keeps 21.75 rem.
- **Hidden, not folded.** The assistant and the files column take no
  width, as the prototype hides them; the 24 px strip and the 52 px rail go,
  and the rail's "New file" with it (the open column keeps its own). The
  hidden files column leaves the work group with its handle: a collapsible
  panel at 0 px stays in the library's layout, which snapped it open when a
  drag of the assistant's edge reflowed the work area, and its handle 1 px
  from the assistant's took both on one drag (found in review, 2026-10-16).
  It comes back from the stage bar or ⌘E, at the width it last had. The
  hidden assistant keeps its 0 px panel and an unseen handle, from which a
  drag still opens it. The navigation's rail is unchanged. Hidden, the
  column unmounts, so what it holds is remembered and put back when it
  comes back (5.26): the open folders, by path, in `useHandleItemState`;
  the scroll and the lesson's tab in `LeftPanel`. The memory lasts for the
  page, is kept per project (`currentWorkspaceId`) and is overwritten by the
  next hide; another project's is ignored. The tree's memory also brings a
  lesson's folders back from its Steps tab, which unmounts the tree the same
  way. The column is not kept mounted out
  of view: the tree's keybinds (Alt+N, F2, Delete) are global and
  `PgExplorer` finds elements through `document`, so a hidden live tree
  would act on keys and miss updates.
- **What survives a reload** is unchanged: `v: 2`, same key and shape. It
  keeps sizes for open panels only (`withoutFoldedSizes`), so the old folded
  widths were never stored, and an open panel's size means the same on the
  flush frame. Considered and dropped the same day: a `v: 3` that cleared
  sizes, which would have reset every user's widths for nothing.
- **Width.** Wherever the frame shows (from 768 px, above the phone's
  pager) it is flush and carries the bars. Between 768 and 1023 the behaviour is 5.2's: the
  navigation starts as a rail and the assistant is the right Sheet. Its
  "Expand assistant" moves from the right edge into the stage bar, whose
  help link now holds that corner; same name, same Sheet. One button per
  name. The phone's pager is unchanged but for the stage's card
  edge, which goes as everywhere else.
- **Telemetry.** The bars' buttons send `layout_panel_toggled` with
  `via: "button"`, as the buttons they replace did. Widen sends
  `layout_assistant_widened {wide}` (prefix `layout`).
- **Keys.** ⌘B, ⌘E, Ctrl+R, Ctrl+J and Ctrl+1..4 are unchanged.

_Rejected:_ a second bar over the assistant (5.17's head is that bar);
keeping the 24 px strip and the 52 px rail (the prototype has neither, and
the stage bar's toggles replace them); a `layout` key per bar (the stored
layout is one value).

## Session footer and account menu (5.15)

Decided with Slava on 2026-10-16 (HOO-2070), from the prototype's sidebar
(`#app`, its footer open, folded and signed out) and the design system's
"Session footer" block. One PR.

- **Two rows replace the chips.** The cluster row (the dot, the name, opens
  the settings on the cluster) and the account row (avatar, login or "Sign
  in", the wallet's short address and balance, a ⇕ mark) open what the chips
  opened. `StatusChips` and its `CHIPS_COMPACT_AT` stop-gap are deleted: the
  rows truncate instead of dropping pieces.
- **One account menu, two anchors.** The account row opens it above itself;
  on the rail, "Account" opens the same menu beside the rail instead of
  unfolding the navigation, as the prototype does. Its groups: the session
  (sign in, or the profile, "Open GitHub profile" and "Sign out"), then
  Settings (⌘,), Docs and the feedback entries, then the wallet. The
  prototype's "Proposal" group (UX evaluation, Back to deck) is left out.
- **Sign-out asks in a `Dialog`**, not in the menu: a menu closes on the
  click that would confirm. Its Sign out waits on the sign-out, busy, so it
  cannot run twice.
- **A failed sign-in** shows "Couldn't sign in" under the account row,
  announced, and its reason in full at the head of the menu, which the rail
  shows too. A sign-in the user cancelled shows nothing. A session that
  arrives after a failed sign-in wins over it (`AccountView.session` is one
  union).
- **The feedback trigger goes into the menu.** "Share feedback" (where a send
  can succeed), "Suggest an idea" and "Report a bug" sit in the account menu;
  the round "Feedback" button is removed. `FeedbackHost` keeps the form and
  its state above the frame and gives the menu its actions; a send in flight
  shows on the account row and on the rail's "Account". The requirement is
  revised in `openspec/specs/client-v2-feedback/spec.md`.
- **The cluster that is down** turns the dot red, adds ", not answering" to
  the names and " · not answering" to the cluster row (Spec 08's NET-02 chip,
  which replaced the "Switch to localnet?" toast), and puts a warning first
  in the menu that opens the settings on the cluster.
- **⌘, toggles the settings** (Ctrl+, off macOS) from anywhere, through the
  same `toggleSettings` the rows use.
- **A widget, `widgets/session-footer`**: `BaseSessionFooter` and
  `SessionFooter`, `BaseRailFooter` and `RailFooter`, `BaseAccountMenu` (both
  footers connect it through `useAccount`), and `useClusterStatus`, moved
  out of the legacy
  `views/flow/header/`. It meets `features/auth` (`PgSession`, whose
  `signInState()` holds sign-in progress and failure) and `features/feedback`
  here, which is why it is a widget. `BaseAppNav` keeps its `footer` and
  `railFooter` slots, so the project list (5.14) and this step touch
  different lines.
- **Telemetry**, prefix `session`: `session_account_menu_opened {from:
  footer | rail}` and `session_account_item_picked {item}`. Under
  `session-footer:account`, a wallet connect or disconnect that throws is
  logged with `report: true` and the user gets a toast (a setup the user
  closed is only logged); a sign-in that failed at a known step is logged,
  and counted by `auth`; any other sign-in or sign-out error is reported.

Kept: "Cluster: <name>" on the rail's dot, "Change cluster, currently
<name>" on the cluster row, "Connect wallet", "Sign in with GitHub" and the
settings trigger attribute (since 5.20 the page covers the triggers, and only
finds them for tests). The
account controls, the row and the rail's button alike, are named
"Account: <login>" or "Account, signed out"; tests match `/^Account/`.

## Home (5.8)

Decided with Slava on 2026-10-15 (HOO-2063). A visitor who starts with no
project lands on Home instead of the gallery modal.

- **When.** On `/` with no project, once the explorer has answered. The route
  initialises the explorer inside the editor's mount, which Home does not
  have, so `useStartView` (`widgets/home`) initialises it itself on `/`
  before it decides; `init` runs its calls one after another, so the route's
  own call later is harmless. An `init` that leaves no project list is
  reported and opens the work.
  Until the answer the shell shows a spinner in Home's place, neither Home
  nor the work. An explorer that has not answered after 10 s
  (`START_TIMEOUT_MS`; IndexedDB held by another tab's upgrade never does)
  is reported and opens the work. Projects listed with none open is still
  Home (`decideStart` asks for a current project, as leaving Home does).
  Home leaves,
  for the rest of the page load, once a project is open: one created or
  switched to, or a tutorial route. The account's projects arriving by sync
  leave Home only when the session opens one (`importWorkspace` opens none;
  the session then switches to the newest), because a work column with
  projects but none open threw "Current workspace not found". Any route
  other than `/` never shows Home.
- **Home replaces the work, it does not cover it.** With `home` set,
  `LayoutShell` keeps the navigation and renders Home where the assistant
  and the work columns go; the stage and console outlets are not rendered,
  so `Write`, and with it upstream's `Primary`, never mounts under Home. The
  route's `setMainPrimary` waits for the work to mount without polling: it
  asks a mounted `Primary` once, and otherwise waits for the mount `Primary`
  announces (`PgView.announceMainPrimaryMount`), one listener of each kind
  per call. A getter that answers with an error is reported
  (`view:main-primary`, `report: true`) and leaves the view as it is, rather
  than being retried; the routes do not await the call. While Home shows, several routes' `setMainPrimary` calls can be
  waiting (strict mode runs `/` twice, then a tutorial route); only the
  newest call sets the view (`mainPrimaryCalls` in `PgView`, an idea ported
  from the redesign reference), else the start route's Default could
  overwrite a tutorial opened from Home. _Rejected:_ Home over the mounted
  columns, cheaper but not a screen of its own; polling `get` every 100 ms,
  which left a listener behind on every attempt.
- **The column bar (with 5.25).** 5.25 says nothing of Home, so Home's
  column gets the work column's bar: the same 44 px `BaseStageBar` with its
  1 px line, over Home, with no stage tabs under it (no stage shows). It
  reads "Home", as the phone's bar does, has no files toggle (no files
  column under Home), and its assistant toggle opens and closes Home's
  Sheet, at every width; its hint names no key, since Ctrl+R does nothing
  under Home. The frame is flush and divided as 5.25 draws it.
- **Keys.** While Home shows, Ctrl+R, Ctrl+J, ⌘E and a deploy's auto-open of
  the console do nothing (no saved layout changes for columns not on
  screen); ⌘B still folds the navigation, which is on screen.
- **Not in this task**: coming back to Home from an open project, and Home
  after the last project is deleted. A route hands `Primary` its content
  once, `PgRouter.navigate` to the current path does nothing, so a remounted
  `Write` stays blank. 5.28 (HOO-2118) does both; see "Home from an open
  project (5.28)".
- **From 768 px.** "Where should we begin?", the composer, three tiles and
  four tutorial cards, built from `composer`, `action-card`, `tag` and
  `button`. New project unfolds `StartFromScratch` under the tiles; Follow a
  tutorial, Open a program and "All N" open the Tutorials or Programs page
  (5.9).
- **Below 768 (`LAYOUT_BREAKPOINTS.phone`).** The pager keeps its menu page;
  the work page's bar holds "Menu" and the title "Home", with no Chat | Code
  and no Preview, and there is no preview page. The page holds the question,
  the quick starts (Continue the last project when there is one, New Anchor
  project, a beginner tutorial), a row naming the tutorials and programs with
  Browse, which opens the Tutorials page (5.9), and the composer at its foot. Home shows
  only with no project open, so Continue never appears yet; `BasePhoneHome`
  and `PhoneHome` handle it already, for HOO-2118.
- **The composer** opens the assistant in a right Sheet at every width,
  since Home stands where the assistant column would be. What the assistant
  does with no project is a later stage's question. The Sheet holds 5.17's
  assistant widget, never offered Widen there (`canWiden` is false while
  Home shows: there is no panel to widen); Home's own composer stays a
  button that opens it, not 5.17's connected composer. When the work takes
  over with that Sheet open (sync's `adopt` can open a project mid-answer),
  the work's assistant opens in its place (the column from 1024 px, its
  Sheet below, the chat page on a phone), reported as
  `layout_panel_toggled {via: auto}`; between 768 and 1023 px it would
  otherwise be a closed Sheet, the conversation gone from view.
- **Widget `widgets/home`**: `BaseHome` and `Home`, `BasePhoneHome` and
  `PhoneHome`. Telemetry prefix `home`: `home_shown` when Home is shown,
  `home_tile_opened {tile: new-project | tutorials | programs}`,
  `home_tutorial_opened`, `home_quickstart_opened {id: continue | new |
  tutorial}`, `home_composer_opened`. A tutorial or a quick start that fails
  to open logs under `home:actions` with `report: true` and tells the user
  (on the tutorial's card, or a `home-action-failed` toast). Home opens no
  gallery since 5.9; its tiles and Browse open pages, which cannot fail to
  open. The program count that cannot be read keeps its ellipsis and is
  logged under `home:programs` only, without `report`.

Kept: the gallery's `[data-gallery-modal]`, "Project name" and "Start", which
`StartFromScratch` brings to Home unchanged; e2e fixtures that seeded a
project through the gallery seed it through Home's New project.

## The Get set up checklist (5.16)

Decided with Slava on 2026-10-19 (HOO-2075), from the prototype's sidebar
(`#app`) and the design system's "Setup list" block. One PR.

- **Where it sits.** At the foot of the navigation's content, above the
  session footer, through a new `setup` slot in `BaseAppNav`. The rail has
  no room for it and shows none; the phone's menu page shows it.
- **Four steps, in this order.** "Connect the assistant" is done while a
  model is connected (`PgAssistant.isConnected`); "Choose a network" always,
  since the default network counts (HOO-2330);
  "Sign in with GitHub" while signed in (`PgSession`); "Connect a wallet"
  while a wallet is connected. A done step shows its value at the right (the
  cluster's name, the login, the wallet's short address); a step to do shows
  a chevron and runs its action when clicked: Connect a model
  (`openConnectDialog`), the GitHub sign-in, the wallet's connect.
- **The title counts.** "Get set up · n of 4", folding the list, with the
  design system's dismiss beside it. The fold is kept per device (HOO-2330,
  #126 Q7): one fold per device, wherever it was made; until there is one,
  a phone's menu page starts folded.
- **It goes for good, on this device.** Dismissing it hides it; so does the
  first moment all four steps are done together. Live state alone would not
  do: the assistant's connection is held per tab, so a new tab would bring
  "3 of 4" back to a user who has finished. One `localStorage` key,
  `setup-list`, holds `{dismissed, completed, folded?}`, read like
  the navigation's pins. Each mark only ever turns true and merges with
  what storage holds, so a tab that read the marks earlier cannot undo
  another tab's dismissal; the fold is the last one any tab stored. A
  refused write is reported once and the change still holds for the page.
- **Open with the designer** (q-20261015-12): whether dismissal belongs to
  the device or the account; until they answer it is per device. The other
  half, the network done by default, was settled by #126's "Already
  answered" table and the prototype (HOO-2330).
- **A widget, `widgets/setup-list`**: `BaseSetupList` draws the design
  system's `setup-list` from props; `SetupList` reads the four states and
  runs the actions. It meets `features/auth` and the assistant's widget,
  which is why it is a widget.
- **Telemetry**, prefix `setup`: `setup_item_picked {item}`,
  `setup_dismissed {done}` and `setup_completed` (once per device). Under
  `setup-list:<module>`, an action that throws is logged with
  `report: true`; a wallet connect that throws also shows a toast, as the
  account menu does, while a failed sign-in shows in the account row
  (`PgSession.signInState`). A wallet setup the user closed and a sign-in
  that failed at a known step are only logged.

## Failed clicks (5.27)

Decided with Slava on 2026-10-19 (HOO-2100). Until now a failed click was
only logged (5.4), and nothing on screen said the action did not happen.

- **A toast says what did not happen.** `reportButtonFailure("<action>")`
  returns the handler that `onError` and a click path's `catch` take; the
  toast reads "Could not <action>." The phrase is the call site's ("copy",
  "export the project", "fetch the account"). The raw error stays in the
  log, never on screen.
- **Shown once.** The terminal prints `Process error: …` and rethrows;
  `PgTerminal.process`, the one way in, marks the failure as shown before
  rethrowing it, and `reportButtonFailure`
  only logs a marked failure. Only while the console is open: the console
  drawer tells the terminal whether it can be seen, and a failure printed
  into a folded console is still toasted, since the user saw nothing. The
  Build and Deploy stages mark their own run's failure shown (`toldByStage`)
  when the run left the stage failed, since the stage then shows it in place
  whether the console is open or not; a run that never started (no terminal
  mounted) keeps its toast. An
  object is matched by identity, a thrown string by value (`Send` throws
  `txResult.err`, which can be a string) and only once, so a later failure
  with the same text is told; `null` and `undefined` are never marked.
- **Passed bare, the factory swallows.** `.catch(reportButtonFailure)`
  type-checks (a rejection is `any`) and calls nothing; a lint rule
  (`no-restricted-syntax`) forbids it.
  The mark and its predicate are declared once, beside `reportButtonFailure`.
- **A repeat replaces.** Every such toast has one `id`, so a second failure
  replaces the first instead of stacking. Its `name` is `button-failed`
  (`overlay_toast_shown {name}`).
- **Unavailable here is not a failure** (HOO-2173). A call to the terminal
  while none is mounted (Home) rejects at once with `TerminalUnmounted`,
  marked by `markUnavailableHere` with its way out; the toast reads
  "Can't <action> here: open a project to use the terminal."
- **Logging is unchanged**: `ui:button`, not marked for reporting. What
  reaches Sentry stays HOO-1800's call.
- **Plain `onClick` paths** whose failure reaches `global-handlers` today as
  an unhandled rejection move onto `AsyncButton`, or catch into
  `reportButtonFailure`.

_Rejected:_ an inline message on the control (a failed click often closed
the dialog or menu it sat in, and one channel reads the same everywhere);
showing the raw error (it is written for the log, not for the user).

## Settings as a full page (5.20)

Decided with Slava on 2026-10-20 (HOO-2071), from the prototype (`#app`,
settings opened from the cluster row, at 1280, 834 and 390 px). How many
sections and whether settings stay in the app or take the page are open
questions to the designer (q-20261015-13); the prototype is followed until
they are answered. One PR.

- **A page, not an overlay.** The settings take the whole window, the
  navigation included: at the left a column with "Back to app" over the
  section list, at the right the sections one after another, centred, about
  36 rem wide. `GearSidebar`, the 22 rem overlay, is deleted. Under it the
  stage bar's tabs (`relative z-10`) drew over the overlay's title, and a grey
  layer floated over the editor; neither can happen when nothing of the app
  is drawn.
- **The app stays mounted.** `LayoutShell` is made invisible
  (`visibility: hidden` and `inert`) while the page shows, never unmounted:
  `Write` must not unmount, and Monaco, the terminal's session and the
  assistant's thread keep their state. Not `display: none`: the shell keeps
  its boxes, so no panel sees a resize to zero (`react-resizable-panels` folds
  a panel on its own when its size drops, 5.1) and Monaco and xterm do not
  re-measure. The page is a sibling of the shell in `Flow`, fixed over the
  whole window, so nothing of the shell's tree changes.
- **The sections**, in order: Network, Project, Block Explorer, Build,
  Connection, Editor, Notification, Server, Test UI, UI, Wallet, and a twelfth,
  Experimental, for `experimental.unstable` (D37; Slava, 2026-10-20: a setting
  is not dropped for want of a section in the prototype). Network and Project
  are the overlay's own (the network chips; Export, From GitHub, From files);
  the rest come from `PgSettings.all`, grouped by the id's prefix as before.
  The overlay's Explorer links (Wallet, Program, Program IDL) sit in Block
  Explorer, shown only when there is a wallet or a program. A setting is a row:
  name and description at the left, the control at the right; on a phone a
  select goes under them, full width, while a switch stays at the right, as
  the prototype's checkbox does. A boolean is a `Switch` (5.3), where the
  prototype draws a checkbox.
- **Sections do not fold.** The prototype's sections are flat, so the
  upstream `Collapsible` groups go. The fold scenario in `client-v2-elements`
  moves to the Build stage's compiler output, the other fold e2e can reach.
- **The section list** scrolls its section into view on a click and marks
  the section being read (`aria-current`), following the scroll. Below
  `LAYOUT_BREAKPOINTS.phone` there is no list: a 60 px bar holds "Back to app"
  (an arrow) and the title.
- **Open and close.** The triggers stay what they are: the cluster row, the
  rail's dot, the account menu's Settings and cluster warning, ⌘,
  (Ctrl+, off macOS). `focus: "network"` lands on the chosen network, any
  other open on the page's heading. "Back to app", Escape (not while a modal
  is open, nor one an open select already took) and ⌘, close it and give
  focus back to the control that opened it; the account menu names its
  trigger (`SettingsRequest.returnTo`), since the item unmounts with the
  menu. ⌘, closes a dialog opened from the page along with it.
  The close control is named "Back to app", its visible text, replacing
  "Close settings" (Slava, 2026-10-20: the name says what the button shows).
- **A widget, `widgets/settings-page`**: `BaseSettingsPage` (the frame, the
  list, the sections, all through props), `BaseSettingRow`, and
  `SettingsPage`, which connects `PgSettings`, the explorer and the wallet.
  `SettingsRequest` (`SettingsFocus`, `SettingsEntry`, `SettingsExit`) and
  the trigger attribute move to `shared/lib`, so the session footer does not
  import another widget. The upstream renderer `app/Panels/Side/Left/` has no
  other user and sits in the `app` layer, which a widget cannot import:
  `Settings.tsx` and its test move into the widget's `ui/` as
  `SettingControl`, in their own commit by the UI move rule, and lose their
  folding groups and popover chrome there. `CustomSetting.tsx` goes to the
  legacy `views/flow/settings/` instead: it is drawn in overlays'
  `ModalFrame`, and a widget cannot import another widget.
- **Taken into this PR from its review** (Slava, 2026-10-21, intakes
  2026-10-20-settings-control-throw, -settings-endpoint-names and
  -settings-popover-over-page):
  - A setting that throws as it renders (a malformed `values` entry, a
    Custom value with no `custom`) no longer unmounts the app beneath the
    page: `SettingsBoundary` puts a notice and "Back to app" in its place and
    reports the error through the logger's `panic`.
  - `server.endpoint` is named "Build server" in the registry, so the two
    selects no longer share a name. `connection.endpoint` was "RPC endpoint"
    here; Settings' polish (HOO-2261) returned it to "Endpoint", as the
    prototype names it.
  - A menu, popover or tooltip open when the page opens closes: they portal
    to `body`, outside the hidden shell, and a modal menu's focus trap would
    pull focus back from the page. `closeOpenLayers` (`shared/lib`) sends an
    Escape from the topmost open layer, never from focus (a project's rename
    field would read it as a cancel), one per frame while a layer is still
    `open`, and nothing when none is (Escape would then close the
    assistant's Sheet as a key's, not the product's). The page opens once
    they are closed, and the trigger of the layer focus was in stands in as
    the control to give focus back to.
  - When the control that opened the page is gone on close (a footer the
    phone's menu page took with it), focus
    goes to the first control that opens the settings still on screen, else
    to the one that opens the navigation. The failure notice closes on
    Escape too, its own listener in place of the page's.
- **Telemetry**, prefix `settings`: `settings_opened {from: cluster | rail |
  menu | key}`, `settings_closed {via: back | escape | key}` and
  `settings_section_picked {section}`. Export and import failures keep going
  through `reportButtonFailure`; the widget logs under `settings-page:*`.

Kept: the region named "Settings", the radio group "Network", every setting
control's name (the setting's name; the two endpoint selects are renamed, see
above), the trigger attribute (tests find the
triggers by it; with nothing of the app on screen, a second click on a
trigger is no longer the way out, "Back to app" is), "Change cluster,
currently <name>" and "Cluster: <name>". The floating wallet is hidden with
the shell, and on a phone opening the settings from the menu page brings
Work into view first. Toasts and dialogs are not the app here: they are the page's own
feedback (a failed export, an import dialog), so `ToastHost` and `ModalHost`
stay outside the hidden shell, above the page.

## Home from an open project (5.28)

Decided with Slava on 2026-10-20 (HOO-2118). 5.8 shows Home only on a start
with no project open; this makes it reachable from an open project, and
going back finds the work as it was left.

- **The work stays mounted while a project is open.** Home still takes the
  assistant's and the work's place in the frame, but while a project is
  current the stage and the console keep rendering into their outlets,
  which Home leaves detached from the page, as the frame already does when
  a phone rotates across `LAYOUT_BREAKPOINTS.phone`. So Monaco keeps its
  models, and with them the undo history, the cursor and the scroll; the
  terminal keeps its scrollback and a running process. The work unmounts
  only when it cannot be drawn, on `/` with no project current: on a start
  with none (5.8), and once the last one is deleted. A route other than `/`
  draws its own page without a project (a lesson before it starts), so it
  keeps the work and never shows Home by itself. _Rejected:_
  unmounting under Home and remounting on the way back, which loses the
  undo history (Monaco disposes every model on unmount) and the console
  buffer; covering the mounted columns with Home, which 5.8 rejected.
- **A `Primary` that mounts again gets the content back.** A route calls
  `PgView.setMainPrimary` once; a `Primary` mounting after that call was
  delivered (the work after the last delete, then a new project) had nobody
  to fill it. `PgView` keeps the newest setter it delivered and hands it to
  a `Primary` that announces its mount while no call waits, so the route's
  view comes back without a second navigation.
- **Home is a view, not a route.** Showing Home from a project leaves the
  address as it is; the route's own content stays in the mounted work.
  `useStartView` becomes the page's view state for the whole load rather
  than a decision taken once at the start.
- **Into Home:** the navigation's Home item (`via: nav`); the last project
  deleted, here, by another tab or by sync (`via: last-deleted`); a
  navigation back to `/` with no project open (`via: back`), which also
  covers a fresh profile that deep-linked a tutorial and went Back without
  starting it. The start keeps `via: start`. Until the start is decided the
  navigation's Home does nothing, so the start's watchdog and its reports
  stay in place. Home in the navigation never
  opens the gallery any more; New project still does, and Tutorials and
  Programs open their pages (5.9).
- **Out of Home:** picking the open project in the navigation's list (which
  otherwise does nothing for the current project), the phone's Continue
  quick start (built in 5.8, shown now that a project can be open under
  Home), and, as in 5.8, any other project created, opened or switched to,
  or a route other than `/`. Sync re-opens the project Home shows over (a
  merge, a reconcile on refocus); that is no way out, or a Home the user
  asked for would vanish on its own. A replayed route view that fails is
  reported by `Primary` (`view:main-primary`), since it is drawn in place of
  the view, never thrown.
- **What stays on under Home.** The kept work's own keys (a tab's Alt+W,
  the console's Ctrl+L, a lesson reader's Escape) are off while Home shows:
  `BaseLayoutShell` sets `KeybindsActive` (`shared/lib`) to false around
  the outlets, and `useKeybind` registers nothing under it. The terminal
  fits itself only while its node is on the page; off it, it measures 0 and
  xterm throws on the columns that gives.
- **The project Home shows over** is told by its id, not its name: sync
  renames a project to follow another device by re-opening it under the new
  name, which is still no way out.
- **A shared project** (temporary: a share or GitHub link) has no row in the
  list to go back by, so over one the navigation's Home, picked again, goes
  back to the work (`via: nav`); over a project the list names it leaves Home
  in place.
- **Telemetry**, prefix `home`: `home_shown` gains `via` (`start`, `nav`,
  `last-deleted` or `back`); `home_left` with `via` (`current-project`,
  `continue`, `open` or `nav`) when the work replaces Home.

## Tutorials and Programs pages (5.9)

Decided with Slava on 2026-10-20 (HOO-2064). Tutorials and Programs in the
navigation open pages, as the prototype draws them, instead of the gallery's
tabs.

- **A page is the shell's `cover` slot.** The navigation stays; the page
  takes the place of the assistant and the work, under the same 44 px column
  bar, which reads "Tutorials" or "Programs" and has no files or assistant
  toggle. With
  Home shown, the page stands where Home was, and Home returns when the page
  closes. With a project open, the page covers the columns while the work
  stays mounted under it, `inert`, so closing the page brings the project
  back as it was, editor and console included. _Rejected:_ unmounting the
  work as Home does, which leaves `Write` blank on the way back (HOO-2118);
  a route per page, which the route's one-shot `setMainPrimary` cannot
  leave either.
- **One decision for the screen.** `screenOf(home, cover)`
  (`widgets/layout-shell/model/screen`) turns the two slots into one union,
  the work, Home, or a page over either, and `LayoutShell`,
  `BaseLayoutShell` and `BasePhonePager` switch on it; none weighs the two
  slots itself. The slots stay the components' props.
- **What closes it.** What the user picks: a tutorial or a program opened
  from the page, a tutorial's route, New project, a project picked in the
  project list (the open one included), Home in the navigation (which over
  the work then shows Home, and under which Home already stands), and the
  product asking for the assistant, which is under a page over the work (over
  Home it opens Home's Sheet above the page). A link whose replace to `/`
  fails closes its page and says so, since nothing would stand under it.
  Never the explorer's own events: it switches to the open project on every
  route's init, and sync switches and creates projects in the background.
  One Open at a time: while one runs, every card's Open waits. Under a page
  the work keeps its keys off (`KeybindsActive`), as 5.28 does under Home,
  and `isWorkInFrame` versus `keepWork` tells the frame from the mount. The
  navigation marks the page's item as current while the page shows. Keys
  that toggle columns (Ctrl+R, Ctrl+J, ⌘E) and a deploy's opening of the
  console do nothing while a page shows, as under Home.
- **Where the state lives.** `widgets/catalog` holds the page open
  (`catalogPage`: `tutorials`, `programs` or none) with `open` and `close`;
  `Flow` reads it and hands it to `LayoutShell` and `AppNav`. Home cannot
  import another widget, so `Flow` gives Home what opens a page. The routes
  `/tutorials` and `/programs` open their page and replace themselves with
  `/` (a push would trap Back on the link), so old links
  (`NotFound`, a tutorial's About) keep working; upstream's
  `views/main/primary/Tutorials` and `Programs` go, and with them the
  unreachable `views/sidebar/tutorials/Component`,
  `views/sidebar/programs/Component` and `components/FilterGroups`. The
  Programs sidebar page goes too, since no route names it; the Tutorials one
  stays, without a `LoadingComponent`, because the tutorial route names it.
  The listing's URL, type and checked fetch move to `entities/program`, which
  the page, Home's count and the gallery share.
- **What a page holds.** A search field (`input-group`, added to the
  registry and installed) filtering by name and description (and a
  program's categories), and a grid of `action-card`s (their facts as
  plain text since 5.13, as the prototype writes them): two
  columns from 720 px, one below. A tutorial's card shows its thumbnail,
  level and framework, and Open calls `PgTutorial.open`. A program's card
  shows its icon, framework and categories, and Open calls `PgGithub.import`
  with its progress on the card. Programs come from `/programs/programs.json`,
  loading and failing as the gallery's tab did, with Retry. No match shows
  `empty`.
- **On a phone** the page is the pager's work page, under the bar's title,
  one column; picking Tutorials or Programs on the menu page goes to it.
- **The gallery stays** for New project and a finished lesson's "Browse
  gallery"; 5.13 restyles it (see "New project (5.13)").
- **Widget `widgets/catalog`**: `BaseCatalogPage` and the connected
  `TutorialsPage` and `ProgramsPage`. Telemetry prefix `catalog`:
  `catalog_shown {page, via: nav | home | link}` when a page shows,
  `catalog_searched {page, empty}` once typing has rested 500 ms on a
  non-empty query (`empty` when nothing matches), `catalog_item_opened
  {page}` when an Open succeeds, `catalog_open_failed {page}` when it
  fails, which also logs under `catalog:open` with `report: true` and tells
  the user on the card. A program list that cannot be read logs under
  `catalog:programs` with `report: true` and offers Retry. A cancelled import
  is no failure.

Kept: `nav_item_opened`, the gallery's `[data-gallery-modal]`, the nav
items' names. (5.13 replaces the gallery's `gallery-tab-*` ids.)

## New project (5.13)

Decided with Slava on 2026-10-20 (HOO-2068). New project looks like the
prototype's "What do you want to build?". The work is stacked on 5.9
(HOO-2064), whose card grid it shares.

- **What the dialog holds.** The lead line, then Start from scratch: a tile
  with a plus, "Blank canvas", "Start from scratch", the framework as a
  `segmented` with the gradient ring, the project name and `brand-button`
  "Start →", in one row from `md` and stacked below it. Under it, Tutorials
  and Programs as one boxed `segmented` with a count each (`…` while the
  programs load, `?` when they failed) beside the catalog's search field,
  one query for both lists; then the chosen list's cards, drawn as the 5.9
  pages draw them, Retry included. The Segmented is a radio group, so the
  gallery's `tab` roles and `gallery-tab-*` ids go; `[data-gallery-modal]`,
  the dialog's name, "Project name" and "Start" stay.
- **One look across the dialog** (HOO-2184): the selected chip keeps the
  design system's gradient ring for the choice that matters, every focus
  is the input's one ring, name and search fields are the design system's
  `input` and `input-group`, the chips, name field and Start are 32 px on
  one centre line, and a fade at the scroll area's foot says the list runs
  on.
- **As the prototype draws the cards** (Slava, 22 Oct, chosen over the
  design system's level tag where the two disagreed): a card's eyebrow is
  plain text,
  level · framework or framework · categories, here and on the 5.9 pages,
  not tag chips; New project's search field has no magnifier.
- **Below `md` (768 px)** the dialog is a page of its own (the installed
  `modal` does it), and every card is one target that ends in a chevron, on
  the 5.9 pages too: the card's own Open hides there already.
- **Where the code lives.** A widget may import neither another widget
  nor `widgets/overlays`, which holds `ModalFrame`. So the dialog's content
  is `widgets/catalog`'s `BaseNewProject` and `NewProject`, beside a
  `BaseCatalogGrid`, `CatalogSearch` and the list hooks `useTutorialList` /
  `useProgramList` that the pages and New project share; 5.9's
  `useCardOpen` takes options: what a finished Open closes (the page by
  default, the dialog here), and who hears a failure. A failure of
  `onOpened` itself is reported, as the card title's rejected Open is.
  `views/flow/gallery/NewWorkspaceModal` shrinks to the `ModalFrame` around
  `NewProject` and holds its state (`useNewProject`) above the frame: a
  dialog stacked on New project (an import's program picker) remounts what
  sits under the frame, and the Open it belongs to must still close New
  project when it finishes. It is still what
  `PgView.setModal` opens, so `PgView.onDidOpenModal` still fires and still
  closes the left Sheet. Start from scratch is one user action with its
  own state, used by New project and by Home, so it becomes
  `features/new-project` (`BaseStartFromScratch`, `StartFromScratch`). The
  gallery's `TutorialsTab`, `ProgramsTab` and `StartFromScratch` go.
  _Rejected:_ a widget `widgets/new-project`, which would import the
  catalog; a second card grid inside the dialog.
- **What closes it.** A project made by Start, a tutorial opened or a
  program imported from a card. A failure stays: Start's under the name
  field, a card's on the card, and a second Start is a retry. New project
  closes only itself, by its dialog id (`PgView.closeModal(null, id)`,
  HOO-2091's close by id): an Open that ends after the dialog was dismissed
  closes nothing but tells its failure in a toast, and Start on Home closes
  nothing.
- **One run at a time**, as on the 5.9 pages, and across both lists and
  Start here: while an Open or Start runs, every card and Start wait.
- **Telemetry.** `features/new-project`, prefix `new_project`:
  `new_project_started {framework}` when Start makes a project,
  `new_project_start_failed {framework}` when it fails, which also logs
  under `new-project:start` with `report: true`. `widgets/catalog` adds
  `catalog_tab_switched {tab}` when the user picks the other list. A card's
  Open keeps `catalog_item_opened` and `catalog_open_failed`.

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
- **The phone breakpoint** is 768 px since HOO-2208, the stock Sidebar's
  line; the prototype's is 720 and the customer's sheet says 1024, and the
  designers are asked to settle it (hoodieshq/solana-playground#126). One
  constant, `LAYOUT_BREAKPOINTS.phone`, which `use-viewport.test.ts` holds to
  `use-mobile`; moving it below 768 needs the design system's Sidebar
  changed with it. 5.1's
  read-only editor below 600 px is gone with 5.7.
