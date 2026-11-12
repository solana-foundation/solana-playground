# Design

## Context

See [proposal.md](proposal.md), "Why". The mirror script copied the submodule's tracked files, laid the fork's
`client-v2/static/` over them, rewrote the head of `index.html`, and wrote `tutorial-timestamps.json` from the
submodule's git history. The Docker image cloned the assets repository at `scripts/assets-commit.txt` to do the same
without git data of the checkout.

## Goals / Non-Goals

**Goals:**

- Every file the tracked `client-v2/public/` keeps is byte-identical to the mirror's last output at the commit in
  `scripts/assets-commit.txt`, apart from `index.html`, which is upstream's file at that commit, and the images,
  which are optimised.
- The served page's head is the one the mirror produced, apart from the card's domain.
- The tutorial lists the app shows do not change.

**Non-Goals:**

- A script in `client-v2/` that syncs assets. The `assets` command belongs to the `sync-upstream` skill and runs
  during an upstream sync (HOO-2687).
- Removing Seahorse's code (the framework, Hello Seahorse); that is separate work.

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
  would date every tutorial by the commit that added `public/`; the dates therefore live in the list, and the list
  is where the fork decides what shows. Rejected: keep `public/tutorial-timestamps.json` and show every folder with a `data.json`. That file
  sits among upstream's assets although only the fork writes it, and a sync would show a new upstream tutorial
  before anyone has reviewed it.
- **A listed name without its folder fails the build.** A typo or a folder an upstream sync removed would otherwise
  drop a tutorial from the app without a sign.
- **Import only the assets the fork uses.** The app shows no upstream Markdown tutorial (`startTutorials` in
  `entities/tutorial/model/start-ladder.ts` keeps the three conversation tutorials), so `public/tutorials/` held
  13 tutorials and a template nobody could open, and every upstream sync would copy more. The import list,
  `scripts/assets-import.txt`, names upstream paths one a line, a trailing `/` for a folder; it holds every
  top-level entry imported before except `tutorials/`. Fonts, icons, languages, themes, and `pyth/` stay listed
  until someone checks what reads them. A tutorial folder `markdown-tutorials.json` lists is imported whole, so
  enabling a Markdown tutorial stays one edit. `frameworks/` stays listed whole, since the Seahorse framework
  still reads `frameworks/seahorse/icon.png`. Rejected: a deny list. An upstream addition would then arrive
  unreviewed, which is what the list exists to stop.
- **A ladder tutorial's thumbnail lives next to its `tutorial.json`.** `generate-tutorials.mjs` bundles a
  thumbnail found beside the definition, as it did for Zero Copy, so Hello Anchor's and Lumberjack's move into
  `src/tutorials/<slug>/` and `public/tutorials/` goes away whole. An upstream thumbnail the fork keeps under
  `public/` would need a list entry and a sync for a file the fork owns. Hello Solana and Hello Seahorse are not
  on the ladder and lose their thumbnails; nothing renders a custom tutorial's thumbnail.
- **The `assets` command writes only what it can prove upstream owns.** It applies a listed path's change only
  when the local copy equals the old assets commit's optimised blob, and reports a fork-owned path (`FORK_OWNED`)
  or a path the fork changed instead of writing it, so a sync never overwrites the fork's edits. The test of the
  skill checks that the import list or `FORK_OWNED` covers every file in `public/`, so a file added by hand
  without a list entry fails before the next sync would leave it behind.
- **Images are optimised once, and every image is checked to be a fixed point.** `scripts/optimise-image.mjs`
  runs SVG through svgo (`multipass`), PNG through sharp losslessly (`compressionLevel` 9, adaptive filtering,
  `palette: false`, since sharp's `effort` would turn on quantisation), and JPEG through sharp's mozjpeg at
  `JPEG_QUALITY`, with metadata stripped. A result that is not smaller keeps the input. A JPEG re-encode must
  save `JPEG_MIN_SAVING` of the size: a second mozjpeg pass at the same quality still saves 0.6 to 3.7 percent on
  the thumbnails, so without the margin an optimised JPEG would not be a fixed point and every pass would lose
  quality. The test in `optimise-image.test.mjs` re-optimises each image in `public/` and `src/tutorials/` and
  fails on any change. The `assets` command optimises what it writes and compares the local copy with the
  optimised old blob, so an image the fork optimised but never edited still takes upstream's change. The output
  is the same only for the pinned svgo and sharp, so a bump of either re-optimises every image in the same change.
  Rejected: lossy PNG (palette quantisation), which changes pixels of the brand files.
- **A custom tutorial needs no asset folder.** `CUSTOM_TUTORIALS` in `craco.config.js` also takes the names of
  `src/tutorials/` folders with a `pages/` folder, so Hello Solana and Hello Seahorse keep their page counts and
  register after their asset folders are gone; `createTutorial` would otherwise throw on a missing entry when the
  tutorials module loads.
- **The list's order is the build's order.** The old code took `readdirSync` order, which is alphabetical on macOS
  but not guaranteed on Linux. The list starts alphabetical, so the order is unchanged on macOS.
- **Keep `scripts/assets-commit.txt` as a record.** It names the upstream commit the copy came from, which an
  upstream sync reads to find the asset changes since then. No test compares it with the fork's `client/public`
  gitlink: that pin stays where it is until HOO-2686, while the record moves with each sync.
- **Ignore only what the `generate` scripts write** (`crates`, `packages`, and each tutorial's `content.json`), in
  `.gitignore` and `.dockerignore` alike, so the Docker image gets the tracked files and still generates the crates
  itself.

## Risks / Trade-offs

- [The tracked files drift from upstream's assets] → an upstream sync runs the `assets` command, which compares
  the assets repository from `scripts/assets-commit.txt` to its new commit and copies the changes to listed paths.
- [A JPEG loses detail at `JPEG_QUALITY`] → the four thumbnails were compared by eye at 80 with no visible
  difference at the size they were viewed, not at pixel zoom. One constant covers every JPEG, so an image that
  needs a higher quality has no setting of its own.
- [A path left out of the import list turns out to be needed] → the command reports every path it leaves out,
  and adding the path to `scripts/assets-import.txt` brings it in.
- [The repository grows by the assets' size] → the files were already in every checkout through the submodule; the
  history grows once, by the size of `public/`.
- [Vercel stops passing `VERCEL_PROJECT_PRODUCTION_URL` to the build] → the card falls back to
  `http://localhost:3000`, which a link preview cannot load; setting `SITE_URL` on the project restores it.
- [An edit to `public/index.html` does not reach a running `yarn dev`] → the page is read when webpack starts;
  restart the dev server.
- [Removing the submodule would break the server deploy] → `client/` is not deployed, but on a release tag
  `cicd.yml` builds it through `reusable-checks.yml` before `deploy_server`, from the `client/public` submodule. So
  the submodule and `.gitmodules` stay, and HOO-2686 removes them with `client/` and that job.
