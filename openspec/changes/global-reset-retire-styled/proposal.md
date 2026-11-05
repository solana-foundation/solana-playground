# Proposal

## Why

client-v2 still styles with two systems: Tailwind with the design system's
tokens, and styled-components over the legacy theme object. Tailwind's reset
(preflight) has stayed off because it would fight the styled-components
globals, so every design-system element carries a partial reset of its own,
and a form control or heading outside it keeps the browser's look. Menus,
dialogs and toasts also still animate for a user who asked the OS for reduced
motion. HOO-2077 is the last step of the New face plan (ui-migration task
5.24).

## What Changes

The work lands in two PRs. Slava split it on 29 Oct, because the wallet
(HOO-2074) and the tablet layout (HOO-2073) are still open and own files
that use styled-components.

**Part 1 (this change's tasks 1-3):**

- Tailwind preflight is on for the whole page. The partial `[data-slot]`
  reset in `src/index.css` goes, since preflight covers it. Monaco and xterm
  are checked under preflight; where its rules break them (box-sizing,
  `img`/`svg` display, `border` on their inner elements), they are excluded
  by a scoped rule, not by turning the reset off.
- One global rule honours `prefers-reduced-motion: reduce` across the design
  system's animations and transitions: menus, dialogs, popovers, toasts, the
  Sheet and the phone pager appear and leave without motion.
- Every module that imports `styled-components`, except those under
  `src/components/Wallet/` (HOO-2074) and `src/widgets/layout-shell/`
  (HOO-2073), is rewritten to Tailwind utilities over the design-system
  tokens. Nothing on screen moves: ids, aria-labels, test ids and the look
  stay as they are. Tests that wrapped a component in styled-components'
  `ThemeProvider` stop needing it.
- A lint rule bans new `styled-components` imports outside the two folders
  still waiting.

**Part 2 (task 4, after HOO-2074 and HOO-2073 land):** the remaining files
move, `styled-components` and `@types/styled-components` leave
`package.json`, and the legacy theme files and the styled theme provider are
deleted.

No telemetry events are added, renamed or removed: no slice under
`features/` or `widgets/` changes behaviour.

## Capabilities

### New Capabilities

- `client-v2-styling`: one reset across the page, the reduced-motion rule,
  and which code may still use styled-components.

### Modified Capabilities

## Impact

- **User-visible:** form controls, headings and lists outside the design
  system lose their browser defaults (the look the DS already gives its own
  elements). A user with reduced motion set no longer sees animated
  overlays. Otherwise nothing moves; before and after screenshots, desktop
  and phone, show it.
- **Code:** about 75 files under `src/components`, `src/views`, `src/app`,
  `src/features`, `src/effects`, `src/frameworks`, `src/hooks` and
  `src/providers`; `src/index.css`; the ESLint config.
- **Out of scope:** the wallet (`src/components/Wallet/`, HOO-2074) and
  the layout shell (`src/widgets/layout-shell/`, HOO-2073) in part 1; any
  visual redesign; the colours Monaco, xterm and shiki get (they keep reading
  plain values through `shared/lib/css-color`); `client/`.
