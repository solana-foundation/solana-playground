# Tasks

## 1. Reset and motion (part 1)

- [x] 1.1 Preflight on in `src/index.css`, the `[data-slot]` reset removed
      but for its font, `line-height: normal` kept on `html`; Monaco and xterm checked in the browser and
      reverted by a scoped rule only where they break. Verify: screenshots
      of the editor and terminal before and after match (HOO-2077;
      plan: [plans/1-reset-and-styled.md](plans/1-reset-and-styled.md), covers 1.1-2.3)
- [x] 1.2 One global `prefers-reduced-motion: reduce` rule over every
      animation and transition. Verify: with reduced motion emulated, a
      dialog, a menu and a toast appear in their end state (an e2e spec
      `client-v2-styling: Opening a dialog with reduced motion`)
      (HOO-2077; after 1.1)

## 2. styled-components out, outside the two open folders (part 1)

- [x] 2.1 A hook (`shared/lib/hooks/use-pg-theme`) that reads `PgTheme.theme` and follows theme and font
      changes; every `useTheme()` from styled-components outside
      `components/Wallet` and `widgets/layout-shell` switched to it.
      Verify: `yarn test-types`, the theme-switch e2e spec stays green
      (HOO-2077)
- [x] 2.2 Every other styled module outside those two folders rewritten to
      Tailwind classes over the same tokens, ids and aria-labels kept;
      tests stop wrapping in styled's `ThemeProvider` where nothing needs
      it. Verify: `yarn run check`; before and after screenshots, desktop
      and phone (HOO-2077; after 2.1)
- [x] 2.3 `no-restricted-imports` bans `styled-components` outside
      `components/Wallet`, `widgets/layout-shell`, `providers/theme` and
      `types/declarations.d.ts`. Verify: `yarn lint` fails on a probe import
      elsewhere (HOO-2077; after 2.2)

## 3. Part 1 lands

- [x] 3.1 ui-migration task 5.24 notes part 1 landed; PR into
      `scope/interface` (HOO-2077; after 1.x and 2.x)

## 4. Part 2 (after HOO-2074 and HOO-2073 merge)

- [ ] 4.1 The wallet and layout shell move off styled-components, the lint
      override goes, `styled-components` and `@types/styled-components`
      leave `package.json`, the legacy theme files and the styled
      `ThemeProvider` are deleted. Verify: no `styled-components` in
      `src/` or `package.json`, `yarn run check` green (HOO-2077, second PR;
      after HOO-2074 and HOO-2073)
