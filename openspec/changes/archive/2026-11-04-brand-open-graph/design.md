# Design

## Context

`brand-head.mjs` (HOO-2568) rewrites the mirrored upstream `index.html` at
`yarn generate` time: it strips upstream's icon links and theme colour and
inserts the brand block after `<meta charset>`. Upstream's head has no
`og:` or `twitter:` tags today. Almaz's `og-meta.html` gives fifteen tags with a
placeholder host, `https://beta.solpg.io`.

## Goals / Non-Goals

**Goals:** a shared link unfurls with the brand image, title and description,
read from markup alone.

**Non-Goals:** the document `<title>` and `meta description` (the brand-icons
change kept that copy out of scope); per-route cards (the app is a single
page, every route serves the same head); attaching the domain.

## Decisions

- **The tags join the brand block, not a second insertion point.** One block
  after the charset keeps the rewrite idempotent by the same strip-then-insert
  path; the strip widens to `<meta property="og:…">` and
  `<meta name="twitter:…">`, and the survivor check covers them, so an
  upstream card added later fails `yarn generate` instead of shipping two.
- **Absolute URLs from one constant.** Crawlers do not resolve relative
  `og:image`, so `%PUBLIC_URL%` cannot be used. The base is the current
  production host, `https://solana-playground-teal.vercel.app`, not Almaz's
  placeholder `beta.solpg.io` (that host is upstream's live site and serves
  no `og.png`). The production domain is not attached yet; swapping it is a
  change to that constant. Vercel's `VERCEL_PROJECT_PRODUCTION_URL` was
  considered and left out: the fork's own Vercel project would then advertise
  its own host, and local builds would differ from deployed ones.
- **Copy is Almaz's, verbatim**, title "Solana Playground" matching the
  manifest name.

## Risks / Trade-offs

- A preview deploy's tags point at production, whose `og.png` exists only
  once this lands in foundation master; until then a validator run against a
  preview shows the text but no image.
- Unfurlers cache cards (Slack about 30 minutes, X up to a week); a link shared
  before landing keeps its old card until the cache expires.
