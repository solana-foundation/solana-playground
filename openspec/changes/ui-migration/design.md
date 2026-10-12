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

- Parallel work. Several streams land small PRs on `master-2.0` at once; no
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
- The rules live on `master-2.0`, where every contributor's agent reads
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

| Library                 | With React 19                                         | Action                             |
| ----------------------- | ----------------------------------------------------- | ---------------------------------- |
| `typescript` `=5.0.4`   | `@types/react` 19 declares TS 5.6                     | Lift the pin (HOO-1855), not first |
| `styled-components` 5.3 | Runs; 5.1.36 types accept React 19                    | Keep 5                             |
| `react-use-clipboard`   | No release supports React 19                          | Replace in `hooks/useCopy.tsx`     |
| `react-select` 5.5      | Peer range excludes 19                                | 5.10 or newer                      |
| `re-resizable` 6.9      | Peer range excludes 19                                | 6.11 or newer                      |
| `react-rnd` 10.3        | Works (passes `nodeRef`, so `findDOMNode` is skipped) | Bump anyway                        |
| Our code                | 20+ `FC` with implicit `children`; 9 global `JSX.`    | Mechanical fixes                   |

HOO-1772 and HOO-1773 change the Monaco and language-server modules; they do
not land in the same week as the upgrade.

## Risks / Trade-offs

- **The upgrade is late for the freeze.** The design system's v0 is due Nov
  11 too, so Breakpoint screens are built on a library still being finished.
  The cut line is open: new tokens on today's layout, or features cut to
  protect the upgrade.
- **styled-components types.** If version 5's types cannot live with React
  19's, the upgrade grows to version 6 across 154 files. The spike says they
  can.
- **Removing themes** is visible to users who picked one. Dark fallback,
  said once.
- **Two sets of primitives** if Base UI stays for the combobox.
- **The read-only editor breakpoint**: 1024 px (HOO-1793) or 600 px (the
  design plan). For the designer.
