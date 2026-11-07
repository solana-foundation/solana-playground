# Design

## Context

See [proposal.md](proposal.md), "Why". The mirror script copied the submodule's tracked files, laid the fork's
`client-v2/static/` over them, rewrote the head of `index.html`, and wrote `tutorial-timestamps.json` from the
submodule's git history. The Docker image cloned the assets repository at `scripts/assets-commit.txt` to do the same
without git data of the checkout.

## Goals / Non-Goals

**Goals:**

- The tracked `client-v2/public/` is byte-identical to the mirror's last output at the commit in
  `scripts/assets-commit.txt`, apart from `tutorial-timestamps.json` and `index.html`, which is upstream's file
  at that commit.
- The served page's head is the one the mirror produced, apart from the card's domain.
- The build includes the same Markdown tutorials, in the same order, with the same dates.

**Non-Goals:**

- A script that syncs assets from upstream. Asset changes come in by hand with an upstream sync (HOO-2687).

## Decisions

- **Track the output, not the inputs.** The fork's overlay existed so that upstream's files stayed byte-identical
  under the mirror. With no mirror, the fork edits its own files in `public/` in place. A submodule of
  `client-v2`'s own was ruled out: a submodule's git directory is shared by every linked worktree, so initialising
  it in one worktree detaches it in the others.
- **The brand head is applied at build time, not committed.** `public/index.html` stays upstream's, so an upstream
  sync copies it without a merge. `craco.config.js` reads it, passes it through `brandHeadFor` from
  `scripts/brand-head.mjs`, and hands the result to CRA's `HtmlWebpackPlugin` as `templateContent`, once per
  webpack start, for `yarn dev` and the production build alike. `InterpolateHtmlPlugin` still fills in
  `%PUBLIC_URL%` afterwards, and a throw from `brandHeadFor` stops webpack before it starts. Rejected: commit the
  branded page. An upstream change to the head would then be a manual merge on every sync, and the card's domain
  would be fixed in a file.
- **The card's domain comes from the build environment.** `resolveSiteUrl` takes `SITE_URL`, else
  `https://$VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets on every build, previews included, else
  `http://localhost:3000`, and fails the build on anything that is not an `http(s)` origin. A preview's card
  therefore names the production domain, which is the page a shared link should open.
- **One fork-owned list enables Markdown tutorials and dates them.** `src/tutorials/markdown-tutorials.json` maps a
  folder name to `{ "added": <unix seconds> }`, and `MARKDOWN_TUTORIALS` in `craco.config.js` is built from its
  names, in its order. The tracked copy has this repository's history, not the assets repository's, so `git log`
  would date every tutorial by the commit that added `public/`; the dates therefore live in the list. Copying
  upstream's tutorial folders as they are keeps the asset sync mechanical, and the list is where the fork decides
  what shows. Rejected: keep `public/tutorial-timestamps.json` and show every folder with a `data.json`. That file
  sits among upstream's assets although only the fork writes it, and a sync would show a new upstream tutorial
  before anyone has reviewed it.
- **A listed name without its folder fails the build.** A typo or a folder an upstream sync removed would otherwise
  drop a tutorial from the app without a sign.
- **The list's order is the build's order.** The old code took `readdirSync` order, which is alphabetical on macOS
  but not guaranteed on Linux. The list starts alphabetical, so the order is unchanged on macOS.
- **Keep `scripts/assets-commit.txt` as a record.** It names the upstream commit the copy came from, which an
  upstream sync reads to find the asset changes since then. No test reads it, since no submodule entry is left to
  compare with.
- **Ignore only what the `generate` scripts write** (`crates`, `packages`, and each tutorial's `content.json`), in
  `.gitignore` and `.dockerignore` alike, so the Docker image gets the tracked files and still generates the crates
  itself.

## Risks / Trade-offs

- [The tracked files drift from upstream's assets] → an upstream sync compares the assets repository from
  `scripts/assets-commit.txt` to its new commit and copies the changes, as HOO-2687 describes.
- [The repository grows by the assets' size] → the files were already in every checkout through the submodule; the
  history grows once, by the size of `public/`.
- [Vercel stops passing `VERCEL_PROJECT_PRODUCTION_URL` to the build] → the card falls back to
  `http://localhost:3000`, which a link preview cannot load; setting `SITE_URL` on the project restores it.
- [An edit to `public/index.html` does not reach a running `yarn dev`] → the page is read when webpack starts;
  restart the dev server.
- [`client/` no longer builds without its submodule] → it is not deployed, CI runs only Prettier on it, and
  HOO-2686 deletes it.
