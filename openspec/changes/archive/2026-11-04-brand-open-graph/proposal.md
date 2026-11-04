# Proposal

## Why

A Playground link pasted into Slack, X or a messenger unfurls as a bare URL or
as upstream's text: the page head has no Open Graph or Twitter card tags and no
share image. Design delivered the share image (`og.png`, 1200×630) and its
meta snippet with the brand icons on 4 Nov, so a shared link can show the
branded card (HOO-2597). Slava, 4 Nov: before Breakpoint, alongside the icons
(HOO-2568), in its own PR.

## What Changes

- `og.png` lives under `client-v2/static/` and reaches `public/` through the
  existing static overlay, like the icons.
- `brand-head.mjs` adds Almaz's Open Graph and Twitter tags to the generated
  `public/index.html` head, after the icon block: type, site name, title
  "Solana Playground" (the manifest name Kat approved), description, URL,
  image with its type, size and alt text, and `summary_large_image`.
- The tags carry absolute URLs on the current production base,
  `https://solana-playground-teal.vercel.app`. The production domain is not
  attached yet; it is one constant to change when it is.
- The document `<title>` and `meta description` stay upstream's.
- Telemetry: none added, renamed or removed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `client-v2-build`: the served page carries the share card tags and serves
  the share image.

## Impact

- `client-v2/static/og.png` (new), `client-v2/scripts/brand-head.mjs` and
  `brand-head.test.mjs`, `client-v2/scripts/brand-manifest.test.mjs` if it
  lists the overlaid files.
- Out of scope: `client/` and its submodule; the document title and
  description copy; attaching the production domain.
