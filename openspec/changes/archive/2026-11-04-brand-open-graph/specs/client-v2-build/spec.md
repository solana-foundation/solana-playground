# Spec Delta

## ADDED Requirements

### Requirement: A shared link unfurls as the brand card

The `index.html` that `client-v2` serves SHALL carry Open Graph and Twitter
card tags in its markup, so a link preview reads them without running the
bundle. Every URL in them SHALL be absolute. The share image SHALL be served
from the site root.

#### Scenario: The generated card tags (manual)

- **WHEN** `scripts/update-static.mjs` has run
- **THEN** `public/index.html` has `og:type` `website`, `og:site_name` and
  `og:title` "Solana Playground", `og:description` "Write, build and deploy
  Solana programs in your browser.", `og:url` the production base,
  `og:image` the production base's `/og.png` with `og:image:type`
  `image/png`, `og:image:width` `1200`, `og:image:height` `630` and an
  `og:image:alt`, and `twitter:card` `summary_large_image` with
  `twitter:title`, `twitter:description`, `twitter:image` and
  `twitter:image:alt` matching the Open Graph ones, each tag exactly once

#### Scenario: The share image is served (manual)

- **WHEN** `scripts/update-static.mjs` has run
- **THEN** `public/og.png` is byte-identical to `client-v2/static/og.png`, a
  1200×630 PNG

#### Scenario: A link preview (manual)

- **WHEN** the deployed page's URL is checked in a card validator or pasted
  into Slack
- **THEN** the preview shows the share image, the title "Solana Playground"
  and the description
