# Proposal

## Why

Playground's icon is upstream's everywhere except the browser tab, and the tab
only switches after the JS bundle runs. `client-v2/public/` mirrors upstream's
`client/public`, so crawlers, link previews, iOS home screens and Android
installs all read upstream's `favicon.ico`, `logo192.png` and `manifest.json`,
and `theme-color` is upstream's `#000000`. Design delivered the brand renders
on 4 Nov, so the tab, the home-screen icon and the install icon can all show
the Solana-brand mark from the first byte (HOO-2568).

## What Changes

- The brand renders (`favicon.ico`, `favicon.svg`, `favicon-96x96.png`,
  `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png`) and a fork-owned `manifest.json` live under
  `client-v2/static/` and replace upstream's copies in `public/` through the
  existing static overlay. User-visible: the brand icon on first paint, on a
  home screen and in an install prompt.
- `update-static.mjs` rewrites the head of the generated `public/index.html`:
  the icon links, the apple-touch icon and `theme-color` `#101011`. Title,
  description and everything else stay upstream's.
- `applyFavicon` and `src/app/favicon.svg` are removed; nothing sets the icon
  at runtime any more.
- The manifest names the app "Solana Playground", short name "Playground"
  (approved by Kat, 4 Nov); no "SolPg" anywhere.
- Telemetry: none added, renamed or removed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `client-v2-build`: the served page and manifest name the brand icons and
  theme colour, with no runtime icon swap.

## Impact

- `client-v2/static/` (new files), `client-v2/scripts/update-static.mjs`, a new
  `client-v2/scripts/brand-head.mjs` with its `node --test` file,
  `client-v2/scripts/brand-manifest.test.mjs`,
  `client-v2/src/index.tsx`, `client-v2/src/app/index.ts`,
  `client-v2/src/app/favicon.ts` and `favicon.svg` (removed),
  `client-v2/scripts/check-colors.mjs` (its favicon exemption goes).
- Out of scope: `client/` and its submodule stay byte-identical; Open Graph
  image and meta are HOO-2597.
