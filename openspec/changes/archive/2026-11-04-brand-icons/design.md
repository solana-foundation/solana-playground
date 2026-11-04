# Design

## Context

`update-static.mjs` mirrors upstream's `client/public` into the gitignored
`client-v2/public`, then `static-overlay.mjs` copies `client-v2/static/` over it
(the program gallery's `programs.json` already lives there). `index.html` comes
only from upstream and holds `<link rel="icon" href="%PUBLIC_URL%/favicon.ico">`,
`<meta name="theme-color" content="#000000">` and
`<link rel="apple-touch-icon" href="%PUBLIC_URL%/logo192.png">`.

## Goals / Non-Goals

**Goals:** brand icons and theme colour in the static markup and the manifest;
no runtime swap.

**Non-Goals:** Open Graph (HOO-2597); title and description copy; any change to
`client/`.

## Decisions

- **Binary renders and `manifest.json` go through the overlay.** They are whole
  files the fork owns, exactly what `static/` is for. Upstream's `logo192.png`
  and `logo512.png` stay in `public/` unreferenced: deleting mirrored files would
  be a second mechanism for no user-visible gain.
- **`index.html` is rewritten, not owned.** A fork copy of the whole page would
  silently drop any later upstream head change (title, description, a script).
  `brand-head.mjs` instead removes every `<link rel="icon">`,
  `<link rel="apple-touch-icon">` and `<meta name="theme-color">` and inserts
  the brand block right after `<meta charset>`. It throws when the page has no
  `<meta charset>` or `</head>`, or when an upstream icon or theme colour
  survives the strip, so an upstream restructure fails `yarn generate` instead
  of shipping an unbranded or mixed head. It is idempotent.
- **Links use `%PUBLIC_URL%`,** like the rest of upstream's head, so CRA
  resolves them for any public path; the manifest's icon paths are relative
  to the manifest, like its `start_url`.
- **`#101011`** is the product background (Almaz; the DS token `--background`, dark theme),
  used for `theme-color`, `theme_color` and `background_color`. The colour
  check scans `src/` only, so the literal in `scripts/` and `static/` needs no
  exemption; the `app/favicon.svg` exemption is removed with the file.
- **`favicon.svg` is served from `static/`** next to the `.ico` (Sergey, Slack
  4 Nov), the same artwork `src/app/favicon.svg` held.

## Risks / Trade-offs

- Browsers cache favicons hard; a returning visitor may see the old icon until
  the cache expires. Not addressable from the page.
