# Playground design system

shadcn/ui and Tailwind 4 in Playground's tokens. Stock shadcn where it fits. Our own components where Playground does something shadcn does not. Ours are written the way shadcn writes its own: one file in `components/ui`, compound parts, `data-slot` on every part, `cva` variants.

Live: https://solana-playground-ds.vercel.app/design-system/
The product with Studio over it: https://solana-playground-ds.vercel.app/#app

## What is where

| Path                         | What                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/styles/tokens.css`      | The tokens. `:root` is paper, `.dark` is the product                                                      |
| `src/styles/theme.css`       | The tokens as Tailwind utilities, and the product utilities: `frosted`, `gradient-stroke`, `brand-action` |
| `src/components/ui/`         | 60 stock shadcn components, untouched, and 26 of ours                                                     |
| `src/hooks/use-indicator.ts` | The measured thumb that Stepper and Segmented slide                                                       |
| `src/ds/`                    | The page itself: foundations, one block per component, the migration map                                  |
| `registry.json`              | Our components, for `npx shadcn add`                                                                      |
| `studio/`                    | Studio's config for Playground, filled in from the `data-slot` names at build time                        |

## Running it

```bash
npm install
npm run dev
```

`npm run build` builds the page, its snapshot, `ds-inject.css` and the registry. The snapshot drives Chromium through the Playwright that `client-v2` installs for its e2e tests, so install `client-v2` first, or point `PLAYWRIGHT` at another copy's `index.mjs`.

## Building and publishing

```bash
bash scripts/site.sh
```

That builds the page, snapshots it, builds `ds-inject.css` and the registry, then puts them on one site with the product and Studio and deploys it to Vercel (hoodies). Use `NO_DEPLOY=1` to assemble only.

The page ships with a snapshot of itself in `index.html`. Studio reads the specimens by fetching the page without running it, so they have to be in the HTML.

## Using ours in client-v2

From `client-v2`, `yarn ds-add <name...>` does all of the below in one step: it builds the registry, serves it, installs with `--overwrite` and stops the server (`client-v2/CLAUDE.md`, "Components"). The manual route, for any other consumer:

Installs come from the repo, not from the public site. Our items depend on each other as `@playground/<name>`, and the consumer says where `@playground` lives. Build the registry and serve it:

```bash
npm run build:registry
npm run registry:serve        # http://127.0.0.1:3010/r, PORT to change it
```

Map the namespace in the consumer's `components.json`:

```json
"registries": {
  "@playground": "http://127.0.0.1:3010/r/{name}.json"
}
```

Then the tokens first, then any component:

```bash
npx shadcn@latest add @playground/playground-tokens
npx shadcn@latest add @playground/stepper
```

`@playground/playground` installs the tokens and all of ours at once. The stock shadcn components ours build on (`button`, `spinner`, `tooltip`) are registry items too, and come along with ours, so an install reaches no registry outside the repo (npm packages still come from npm). The layout shell's stock parts are separate items, installed by name: `resizable`, and `sidebar`, which brings `button`, `input`, `separator`, `sheet`, `skeleton`, `tooltip` and the `use-mobile` hook. Then import `playground-tokens.css` and `playground-theme.css` after `tailwindcss` in the app's CSS, and put `dark` on `<html>`.

Current shadcn needs React 19: it passes `ref` as a plain prop, and React 17 drops it. So client-v2 moves to React 19 before the first component.

Two of ours need more than the copied files. `message-scroller` and `questionnaire` import the runtime package `@shadcn/react`, which needs React 19; it becomes a dependency of client-v2 when the first of them is installed. `combobox` alone is built on `@base-ui/react`, not Radix; the first ticket that needs a combobox decides whether Base UI stays or the combobox is rebuilt on Radix, so the client carries one set of primitives.

## How Studio connects

- The Add tab reads every `[data-ds-block]` on the page. The title is its `h4`, and the specimens are the children of its first `.row`.
- On the product, Studio links `ds-inject.css`, so a specimen added there wears the system's clothes. That stylesheet has no global reset, and its utilities sit outside any layer, so they win over the product's bare element rules.
- Picking anything with a `data-slot` names it by that slot, and its variant by `data-variant`, `data-size` or `data-status`.
- The Design tab's tokens and choices write CSS variables, so everything built on the system follows at once.
