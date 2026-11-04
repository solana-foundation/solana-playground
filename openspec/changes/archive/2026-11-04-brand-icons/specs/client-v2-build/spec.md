# Spec Delta

## ADDED Requirements

### Requirement: The served page names the brand icons without running script

The `index.html` that `client-v2` serves SHALL name the brand icons and the
brand theme colour in its markup, so a browser, a crawler or a home screen
reads them without running the bundle. `manifest.json` SHALL list the brand
app icons. No script SHALL replace the page icon at runtime.

#### Scenario: The generated head

- **WHEN** `scripts/update-static.mjs` has run
- **THEN** `public/index.html` has `<link rel="icon">` for `/favicon.ico`
  (`sizes="32x32"`), `/favicon.svg` (`type="image/svg+xml"`) and
  `/favicon-96x96.png`, `<link rel="apple-touch-icon">` for
  `/apple-touch-icon.png`, and `<meta name="theme-color" content="#101011">`,
  and no other icon link or theme colour

#### Scenario: Served icon files are the brand renders

- **WHEN** `scripts/update-static.mjs` has run
- **THEN** each icon file and `manifest.json` in `public/` is byte-identical
  to its copy under `client-v2/static/`

#### Scenario: The manifest

- **WHEN** DevTools > Application > Manifest reads `/manifest.json`
- **THEN** it names the app "Solana Playground" (short name "Playground"),
  lists `icon-192.png` and `icon-512.png` with purpose `any` and
  `icon-maskable-512.png` with purpose `maskable`, and has `theme_color` and
  `background_color` `#101011`

#### Scenario: A hard reload

- **WHEN** the page is hard-reloaded
- **THEN** the tab shows the brand icon from first paint and no upstream icon
