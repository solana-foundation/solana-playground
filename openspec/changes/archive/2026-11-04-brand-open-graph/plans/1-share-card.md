# Share Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a shared Playground link unfurls with Almaz's share image, title and description.

**Architecture:** `og.png` joins the files `static-overlay.mjs` copies into `public/`. `brand-head.mjs` appends the Open Graph and Twitter tags to its brand block, widens its strip to `og:`/`twitter:` meta tags and counts them in its survivor check.

**Tech Stack:** Node ESM scripts, `node --test` (`yarn test-api`).

**Spec:** `openspec/changes/brand-open-graph/specs/client-v2-build/spec.md`, `design.md`.

## Global Constraints

- Base URL `https://solana-playground-teal.vercel.app`, one exported constant `SITE_URL`.
- Copy verbatim from Almaz's `og-meta.html`: title "Solana Playground", description "Write, build and deploy Solana programs in your browser.", alt "Solana Playground logo on a dark background with the line: Write, build and deploy Solana programs in your browser."
- `<title>` and `meta description` stay upstream's.

## Review Focus

- A second run must not duplicate the card tags (idempotence).
- An upstream `og:`/`twitter:` tag added later must not ship beside ours: stripped when line-wise, otherwise the build fails.
- Every URL in the card is absolute (`https://`), never `%PUBLIC_URL%`.
- `og.png` exists in `static/` and is 1200×630, matching the declared size.

---

### Task 1: Share card

**Files:**
- Create: `client-v2/static/og.png` (Almaz's file, unchanged)
- Modify: `client-v2/scripts/brand-head.mjs`
- Test: `client-v2/scripts/brand-head.test.mjs`

**Interfaces:**
- Produces: `export const SITE_URL: string`; `BRAND_HEAD` gains the fifteen card tags after the icon block.

- [x] **Step 1: Failing tests** in `brand-head.test.mjs`:
  - `the head carries the share card, each tag once` — for each `[attr, key, value]` of the spec's fifteen tags, exactly one matching tag; `og:image` and `twitter:image` equal `${SITE_URL}/og.png`, `og:url` equals `${SITE_URL}/`.
  - `every card URL is absolute` — each `content` of `og:url|og:image|twitter:image` starts with `https://`.
  - `an upstream card tag gives way to ours` — UPSTREAM plus `<meta property="og:title" content="Old" />` on its own line → no `Old`.
  - `an upstream card tag the strip cannot remove fails` — `<meta name="twitter:card" content="summary" /><title>` → throws.
  - `the share image is a 1200x630 PNG in static/` — read `static/og.png`, PNG signature, IHDR width 1200, height 630.
- [x] **Step 2:** `node --test scripts/brand-head.test.mjs` → the new cases fail.
- [x] **Step 3:** copy `og.png`; add `SITE_URL` and the card tags to `BRAND_HEAD`; extend `REPLACED` with `<meta …property="og:…">` / `<meta …name="twitter:…">`; add a `CARD_TAG` count to the survivor check.
- [x] **Step 4:** `node --test scripts/brand-head.test.mjs` → all pass; `node scripts/update-static.mjs` then `grep -c 'og:\|twitter:' public/index.html` → 15.
- [x] **Step 5:** commit `feat(client-v2): share card: og.png and Open Graph/Twitter tags (HOO-2597)`.
