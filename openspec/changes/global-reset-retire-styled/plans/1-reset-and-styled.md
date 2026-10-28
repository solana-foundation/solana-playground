# Plan: tasks 1.1-2.3, the first PR of HOO-2077

**Goal:** preflight on, one reduced-motion rule, and styled-components gone
from every module outside `src/components/Wallet/` and
`src/widgets/layout-shell/`, with nothing on screen moving.

**Gate:** `yarn run check` plus the e2e spec this PR adds; before and after
screenshots, desktop (1440x900) and phone (390x844), of every screen and
overlay the moved modules draw. e2e beyond the added spec is CI's.

## Steps

1. **Before screenshots.** One Playwright script
   (`scratchpad/shots.mjs`, not committed) drives the dev server on :13060
   through every screen and overlay and saves PNGs to `shots/before/`. The
   same script later writes `shots/after/`; a pixel diff lists what moved.
2. **Reset and motion (1.1, 1.2).** `src/index.css`: import
   `tailwindcss/preflight.css` into `layer(base)`, delete the `[data-slot]`
   reset, put the text font on `body`; add the reduced-motion rule. Check
   Monaco and xterm in the browser; revert under `.monaco-editor` or
   `.xterm` only what breaks. e2e spec
   `e2e/reduced-motion.e2e.spec.ts`: with `reducedMotion: "reduce"`, open
   a dialog, a menu and a toast; their computed `animation-duration` and
   `transition-duration` are at most 0.01ms.
3. **Theme hook (2.1).** `src/shared/lib/hooks/use-pg-theme.ts` returns `PgTheme.theme`
   and re-renders on `onDidChangeThemeName` / `onDidChangeFontFamily`.
   Replace styled's `useTheme()` in Monaco, Terminal, CodeBlock,
   BaseConflictResolver, FeedbackWidget, Folders, useHandleItemState,
   useDifferentBackground.
4. **Move the styled modules (2.2)**, in five groups, one commit each, run
   as parallel subagents on disjoint files:
   - A. `views/sidebar/explorer/**`
   - B. `views/sidebar/assistant/**`, `app/ConnectDialog` test,
     `features/feedback/ui`, `features/persistence/ui`
   - C. `components/` other than `Wallet`, `Editor`, `EditorWithTabs`,
     `Terminal`, `Markdown`, `CodeBlock`
   - D. `views/flow/**`, `app/Panels/**`, `effects/**`, `frameworks/**`,
     `hooks/useDifferentBackground.tsx`
   - E. (me) `components/Editor/**`, `EditorWithTabs`, `Terminal`,
     `Markdown`, `CodeBlock`, after step 2's Monaco and xterm check
   Rules for every group: each `theme.*` value is read through
   `src/themes/palette.ts` (and the defaults in `src/utils/theme`) to its
   token and written as the theme utility (`bg-surface-base`,
   `text-muted-foreground`, ...) or `[var(--token)]`; classes join with
   `cn` from `@/shared/lib/utils`; element type, ids, aria-labels, test
   ids and nesting unchanged; a moved component still takes `className`
   (merged last) and forwards its ref where the styled one did, because
   the wallet and layout shell may still wrap it with `styled(...)`;
   exports and props unchanged. Keyframes go to `src/index.css` as
   `@keyframes` + a utility, or `tw-animate-css` where it has one.
5. **Lint (2.3).** `no-restricted-imports` for `styled-components` in
   `eslintConfig`, overridden for `src/components/Wallet/**`,
   `src/widgets/layout-shell/**`, `src/providers/theme/**`.
6. **After screenshots and diff**; fix every unintended move.
7. **Gate**, sx review (full + default), PR into `scope/interface`.
