# Spec Delta

## ADDED Requirements

### Requirement: One list enables the Markdown tutorials

The build SHALL include a Markdown tutorial from `client-v2/public/tutorials/` only when
`client-v2/src/tutorials/markdown-tutorials.json` lists its folder name, and SHALL take the tutorial's date from
that entry's `added`. A listed name whose folder or `data.json` is missing SHALL fail the build with a message that
names it.

#### Scenario: A listed tutorial shows with its date (manual)

- **WHEN** `public/tutorials/` holds a Markdown tutorial's folder, `markdown-tutorials.json` lists it with `added`
  `1698672911`, and the production build has run
- **THEN** the built tutorial data carries that tutorial with `unixTimestamp` `1698672911`, and its link
  `/tutorials/<folder>` opens it

#### Scenario: An unlisted folder is not shown (manual)

- **WHEN** `public/tutorials/` holds a folder with a `data.json` that `markdown-tutorials.json` does not list, and
  the production build has run
- **THEN** the Tutorials page does not show that tutorial, and the built tutorial data has no entry for it

#### Scenario: A listed name with no folder fails the build (manual)

- **WHEN** `markdown-tutorials.json` lists a name that has no folder under `public/tutorials/`
- **THEN** the production build fails, and its error names that entry and the missing `data.json` path

### Requirement: An upstream sync imports only the listed assets

An upstream sync SHALL copy into `client-v2/public/` only the upstream asset paths that
`client-v2/scripts/assets-import.txt` lists, as a file or under a folder, or that lie in a tutorial folder
`client-v2/src/tutorials/markdown-tutorials.json` lists. It SHALL report every other changed path without writing
it, and SHALL NOT write a fork-owned path or a path whose copy the fork changed.

#### Scenario: An unlisted asset path is not imported (manual)

- **WHEN** `assets-commit.txt` names an earlier assets commit, upstream's changes since then include a path under
  `tutorials/` that neither list covers, and `sync-upstream.mjs assets` runs
- **THEN** the summary lists that path as not imported, `client-v2/public/` has no file at that path, and only
  listed paths appear among the written ones

### Requirement: The images are optimised

Every SVG, PNG, and JPEG tracked under `client-v2/public/` and `client-v2/src/tutorials/` SHALL be a fixed point
of `client-v2/scripts/optimise-image.mjs`: optimising it again SHALL return the same bytes. `yarn test-api` SHALL
fail on an image that is not.

#### Scenario: An unoptimised image fails the check (manual)

- **WHEN** a PNG saved without compression is added under `client-v2/public/` and `yarn test-api` runs
- **THEN** `scripts/optimise-image.test.mjs` fails and names that file, and passes once
  `node scripts/optimise-image.mjs <file>` has rewritten it

## MODIFIED Requirements

### Requirement: The served page names the brand icons without running script

The `index.html` that `client-v2` serves SHALL name the brand icons and the
brand theme colour in its markup, so a browser, a crawler or a home screen
reads them without running the bundle. `manifest.json` SHALL list the brand
app icons. No script SHALL replace the page icon at runtime.

#### Scenario: The generated head (manual)

- **WHEN** the production build has run, or `yarn dev` serves `/`
- **THEN** `build/index.html`, or the served page, has `<link rel="icon">` for `/favicon.ico`
  (`sizes="32x32"`), `/favicon.svg` (`type="image/svg+xml"`) and
  `/favicon-96x96.png`, `<link rel="apple-touch-icon">` for
  `/apple-touch-icon.png`, and `<meta name="theme-color" content="#101011">`,
  and no other icon link or theme colour

#### Scenario: Served icon files are the brand renders (manual)

- **WHEN** the production build has run
- **THEN** each icon file and `manifest.json` in `build/` is byte-identical
  to its tracked copy under `client-v2/public/`, and the icon files are the
  brand renders (HOO-2568), not upstream's

#### Scenario: The manifest (manual)

- **WHEN** DevTools > Application > Manifest reads `/manifest.json`
- **THEN** it names the app "Solana Playground" (short name "Playground"),
  lists `icon-192.png` and `icon-512.png` with purpose `any` and
  `icon-maskable-512.png` with purpose `maskable`, and has `theme_color` and
  `background_color` `#101011`

#### Scenario: A hard reload (manual)

- **WHEN** the page is hard-reloaded
- **THEN** the tab shows the brand icon from first paint and no upstream icon

### Requirement: A shared link unfurls as the brand card

The `index.html` that `client-v2` serves SHALL carry Open Graph and Twitter
card tags in its markup, so a link preview reads them without running the
bundle. Every URL in them SHALL be absolute, on the site URL the build
environment gives: `SITE_URL`, else Vercel's production domain, else the local
dev server. The share image SHALL be served from the site root.

#### Scenario: The generated card tags (manual)

- **WHEN** the production build has run, or `yarn dev` serves `/`
- **THEN** `build/index.html`, or the served page, has `og:type` `website`, `og:site_name` and
  `og:title` "Solana Playground", `og:description` "Write, build and deploy
  Solana programs in your browser.", `og:url` the site URL,
  `og:image` the site URL's `/og.png` with `og:image:type`
  `image/png`, `og:image:width` `1200`, `og:image:height` `630` and an
  `og:image:alt`, and `twitter:card` `summary_large_image` with
  `twitter:title`, `twitter:description`, `twitter:image` and
  `twitter:image:alt` matching the Open Graph ones, each tag exactly once

#### Scenario: The card's domain comes from the build environment (manual)

- **WHEN** the production build runs with `SITE_URL=https://example.test`, then with only
  `VERCEL_PROJECT_PRODUCTION_URL=example.vercel.app`, then with neither
- **THEN** `og:url` in `build/index.html` is `https://example.test/`, then
  `https://example.vercel.app/`, then `http://localhost:3000/`, and `og:image` is the same origin's `/og.png` each
  time

#### Scenario: A site URL that is not an origin fails the build (manual)

- **WHEN** the production build runs with `SITE_URL=example.test`
- **THEN** the build fails, and its error names `SITE_URL`

#### Scenario: The share image is served (manual)

- **WHEN** the production build has run
- **THEN** `build/og.png` is byte-identical to the tracked
  `client-v2/public/og.png`, a 1200×630 PNG

#### Scenario: A link preview (manual)

- **WHEN** the deployed page's URL is checked in a card validator or pasted
  into Slack
- **THEN** the preview shows the share image, the title "Solana Playground"
  and the description
