# Palette sweep after the cool palette (HOO-2601)

**Goal:** Light code reads again, and nothing in the dark theme still shows the
old colours.

**Spec:** the ticket, HOO-2601. It is the proposal; no new OpenSpec change, and
so no task line in `tasks.md` to number this plan or link it from.

**Approach:** one token change in the design system, installed with
`yarn ds-add`. The audit on `scope/interface-2` @ ee60fba5b found no warm literal
in art, gradients, Monaco, `og.png` or docs, so everything else is verification.

## Global constraints

- Tokens change in `design-system/src/styles/tokens.css`; the client copy is
  installed, never edited by hand.
- Dark values do not change.
- Light values are the prototype branch's (`almaz/mobile-tutorial-prototype`
  f7d42bf2e): keyword `#be185d`, type `#0369a1`, function `#047857`, string
  `#ad4f08`, number `#6d28d9`, comment `#6b6b72`, plain `#27272a`.

## Review focus

- Monaco after a theme switch without a reload: colours must not stay on the
  previous theme's.
- Shiki code blocks after a theme switch: the theme is cached by name.

## Task 1: syntax tokens per theme

**Files:** `design-system/src/styles/tokens.css`,
`design-system/src/ds/pg-blocks.tsx`, `client-v2/src/themes/syntax-tokens.test.ts`,
`client-v2/src/app/styles/playground-tokens.css` (installed)

- [ ] Write the failing test: each `--syntax-*` is defined in both the `:root`
      and `.dark` blocks and not in the shared block, the client's copy matches
      the design system's, and each Light value reaches 4.5:1 on
      `--surface-base`, `--surface-panel`, `--surface`, `--surface-raised` and
      `--surface-well`.
- [ ] Run `yarn vitest run src/themes/syntax-tokens.test.ts`; it fails.
- [ ] Move the seven `--syntax-*` out of the shared `:root` into the two theme
      blocks. Drop `SYNTAX_BOTH` from `pg-blocks.tsx`: its reason was that the
      colours only worked on dark.
- [ ] `yarn ds-add playground-tokens`, then rerun the test; it passes.

## Task 2: Monaco's own defaults

The browser showed what the literal search could not: colours Monaco draws
itself when the theme names none. Gold, orchid and brown brackets, an orange find
match, and the active line number.

**Files:** `client-v2/src/components/Editor/Monaco/Monaco.tsx`,
`client-v2/e2e/themes.e2e.spec.ts`

- [ ] Add an e2e test: bracket levels and the active line number compute to their
      tokens in both themes, and the find match is no longer Monaco's orange.
- [ ] Name them in `defineTheme`: brackets 1 to 3 are `--text-secondary`,
      `--syntax-number` and `--syntax-type`; the unexpected bracket is the error
      colour; the active number is `gutter.activeColor`; find uses the selection
      and search-match colours.

## Task 3: verify in the browser

- [ ] Screenshots before and after: Monaco and a code block, both themes, read
      through a live theme switch.
- [ ] Read the computed Monaco token colours in both themes.
- [ ] Compare the dark tokens with the DS stand. Almaz's stand answers 401 and
      is noted as not compared.
