# Design

## Context

See proposal.md. Before this change, Tailwind 4 ran beside
styled-components 5: `src/index.css` imported Tailwind's theme and utilities
but not its preflight, and carried a `:where([data-slot] ...)` reset so
design-system elements lost the browser's button face. The legacy theme object (`src/themes/palette.ts`) already holds
only `var(--token)` references, so a styled rule's colour maps one to one to
a design-system token. styled CSS is unlayered and beats any `@layer` rule on
the same property, preflight included.

## Goals / Non-Goals

**Goals:** preflight on with nothing on screen moving; one reduced-motion
rule; the styled-components footprint cut down to the two folders whose
tickets are open, and held there by lint.

**Non-Goals:** redesigning any component while moving it; touching Monaco or
xterm internals (client-v2/CLAUDE.md, "Never moved along the way"); removing
`PgTheme` itself, which Monaco, xterm and shiki read for plain colour values.

## Decisions

- **Preflight is imported into `@layer base`**
  (`@import "tailwindcss/preflight.css" layer(base)`), the order
  `theme, base, components, utilities` already declared. Utilities beat it,
  and while the wallet and layout shell keep their styled rules, those still
  beat it too, so the two folders left for part 2 look the same with it on.
  The `[data-slot]` reset is deleted, since preflight does all of it; only
  its `font-family` stays, because the legacy theme provider still sets the
  code font on the app's root. `html` keeps `line-height: normal` over
  preflight's 1.5: every screen was drawn on the browser's `normal`, and 1.5
  grew every block of text that sets no leading of its own.
  _Rejected:_ preflight scoped to a wrapper class (two resets to maintain,
  and portalled overlays escape the wrapper).
- **Monaco and xterm are checked, then excluded only where needed.** Both
  ship their own CSS and size their own layout; preflight's
  `box-sizing: border-box` and `img, svg { display: block }` are the known
  risks. Each is checked in the browser (text, cursor, selection, minimap,
  terminal rows); a break gets a scoped revert under `.monaco-editor` or
  `.xterm` in `@layer base`, with a comment naming what it fixes. The
  check found nothing to revert: the old global reset already made every
  box `border-box`, and the screenshots of both match. Inline `code` keeps
  the browser's monospace (`font-family` and `font-size: revert` on
  `code, kbd, samp, pre`), since the screens were drawn on it, and inline
  icons (`Svg`, the file icons) keep `inline` on the baseline.
- **One reduced-motion rule in `@layer base`**:
  under `@media (prefers-reduced-motion: reduce)`, every element and
  pseudo-element gets `animation-duration` and `transition-duration` of
  `0.01ms` and one iteration, with `!important` (an `!important` in a lower
  layer still beats a normal declaration in a higher one, and
  `tw-animate-css` sets durations on the element). Near-zero rather than
  `none` keeps `animationend` firing, which Radix's presence waits on to
  unmount a closing overlay. The per-component `motion-reduce:` utilities
  already installed stay; they are the design system's.
- **A styled component becomes Tailwind classes over the same tokens.**
  Each `theme.*` value is read through `palette.ts` to the token it names
  (`bgPrimary` is `--surface-base`, `textSecondary` is `--text-secondary`,
  and so on), then written with the theme's utility (`bg-...`, `text-...`)
  or an arbitrary value `[var(--token)]` where no utility exists. Classes are
  joined with `cn` from `shared/lib`. Element type, ids, aria-labels, test
  ids and DOM nesting stay as they were.
- **The code font is the user's, through a variable.** Settings offer two
  code fonts, so `theme.font.code.family` is not the design system's
  `--font-code`. `PgTheme.set` writes `--pg-font-code` on `<html>`, and the
  `font-pg-code` utility reads it. Markdown's GitHub stylesheet moves to an
  unlayered `Markdown.css` scoped to `.pg-markdown`, flattened from the
  styled block (nesting is past the Safari 16.4 floor).
- **`useTheme()` callers read `PgTheme.theme`** through a small hook in
  `src/shared/lib/hooks/` that subscribes to `PgTheme.onDidChangeThemeName` and
  `onDidChangeFontFamily` (`usePgTheme`), so a component that needs a JS value (Monaco
  options, a font size) no longer needs the styled context. The styled
  `ThemeProvider` stays in part 1 for the wallet.
- **Lint holds the line.** `no-restricted-imports` bans `styled-components`
  in the layers' existing override and in a new one for the legacy roots;
  `src/widgets/layout-shell/**` gets the layers' list without it, and the
  wallet, `src/providers/theme/` and the theme's type declaration are left
  out. ESLint replaces a rule's options per matching override, so the ban
  rides in the lists that already exist rather than a `src/**` override,
  which would have dropped the `uuid` and `cn` bans. Part 2 deletes the
  exceptions.

## Risks / Trade-offs

- [A styled rule relied on a browser default preflight removes: a heading
  margin, a list bullet, a button border] → before and after screenshots of
  every screen and overlay, desktop and phone, compared side by side.
- [Seventy-odd files in one PR are hard to review] → one commit per area,
  each mechanical; no behaviour change, so the existing unit and e2e suites
  are the regression net.
- [The wallet's ticket edits files this PR does not touch, but may touch a
  shared component (Input, Tabs, Loading) this PR moves] → keep the moved
  components' props and exports unchanged, so HOO-2074 rebases cleanly.

## Migration Plan

Part 1 merges into `scope/interface`. Part 2 is task 4, after HOO-2074 and
HOO-2073 merge; it removes the lint override, the dependency and the old
theme files. Rollback is a revert of the PR.
