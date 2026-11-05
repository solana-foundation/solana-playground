# Plan: brand icons in the static markup (brand-icons 1.1–1.3, HOO-2568)

Goal: the served `index.html` and `manifest.json` name the brand icons and
`#101011`; nothing swaps the icon at runtime.

1. **Test first.** `client-v2/scripts/brand-head.test.mjs` (`node --test`,
   collected by `yarn test-api`): upstream's head becomes the brand head;
   idempotent; throws without `<meta charset>` or `</head>`, or when an
   upstream icon survives the strip; keeps title and description.
   `brand-manifest.test.mjs` checks the manifest and fails while the names
   are a placeholder.
2. **`brand-head.mjs`**: `brandHead(html)` and `BRAND_HEAD` block; strip icon
   links, apple-touch links and theme-color metas; insert after `<meta charset>`.
3. **`update-static.mjs`**: after the overlay, read `public/index.html`, write
   `brandHead(...)`; log it.
4. **Static files**: copy the seven renders and a `manifest.json`
   (name/short_name placeholder) into `client-v2/static/`; a `README.md` there
   says what they are and where they came from.
5. **Remove** `src/app/favicon.ts`, `favicon.svg`, the export and call; drop the
   check-colors exemption and its test, if any.
6. **Verify**: `node --test scripts/brand-head.test.mjs scripts/static-overlay.test.mjs`,
   `yarn generate-fast` then grep `public/index.html`, `yarn run check`,
   dev server + Playwright: tab icon, DevTools manifest (screenshots before/after).
