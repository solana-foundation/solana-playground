# Proposal

## Why

`client-v2/public/` was a gitignored mirror of upstream's `client/public` submodule, rebuilt by
`scripts/update-static.mjs` with the fork's `client-v2/static/` files and a rewritten head on top (HOO-2685). A
checkout, a worktree, a CI job, the Docker image, and a Vercel build each had to reach the submodule, with full
history for the tutorial dates, before the client could build. Tracking the files removes that dependency, and the
fork's assets are edited where they are served.

## What Changes

- `client-v2/public/` becomes tracked files: upstream's assets at the commit in `scripts/assets-commit.txt`, the
  brand icons, `manifest.json`, `og.png`, and the curated `programs/programs.json`. Only the files the `generate`
  scripts write there stay gitignored.
- `public/index.html` is upstream's file as is, so an upstream sync copies it unchanged. `scripts/brand-head.mjs`
  adds the brand icons and share card to its head when webpack writes the page, in `yarn dev` and the production
  build alike. The card's domain comes from the build environment (`SITE_URL`, else Vercel's
  `VERCEL_PROJECT_PRODUCTION_URL`, else `http://localhost:3000`) instead of a hardcoded preview host, so a
  production build names the production domain.
- The fork decides which Markdown tutorials the app shows in one file it owns,
  `client-v2/src/tutorials/markdown-tutorials.json`, which also holds each tutorial's date. The tracked copy has no
  upstream history to date a tutorial from, and an upstream sync that adds a tutorial folder does not show it until
  someone enables it. A listed name with no folder fails the build. `craco.config.js` no longer reads git history
  for tutorial dates.
- The app shows no upstream Markdown tutorial: its tutorial lists keep only the start ladder (Hello Anchor,
  Lumberjack, Zero Copy), all conversation tutorials. So the fork imports only the part of upstream's assets it
  uses, named in `client-v2/scripts/assets-import.txt`: every top-level entry it imported before except
  `tutorials/`. A tutorial folder that `markdown-tutorials.json` lists is imported whole. `public/tutorials/` is
  deleted, and `markdown-tutorials.json` starts empty. Hello Anchor's and Lumberjack's thumbnails move next to
  their `tutorial.json`, as Zero Copy's already is, and the build bundles them. Hello Solana and Hello Seahorse
  lose their thumbnails; Seahorse's code stays until it is removed separately, and `craco.config.js` takes a
  custom tutorial's page count from its `src/` pages when it has no asset folder, so both still register.
- The `sync-upstream` skill's `assets` command applies upstream's changes to the listed paths, reports fork-owned
  and fork-changed paths, paths the list leaves out, and new upstream tutorials, and updates
  `scripts/assets-commit.txt`.
- Every SVG, PNG, and JPEG in `client-v2/public/` and `client-v2/src/tutorials/` is optimised once, the brand
  files included, by `client-v2/scripts/optimise-image.mjs` (svgo; sharp lossless PNG; sharp mozjpeg JPEG), and
  the `assets` command optimises what it imports. The 31 images were served as committed, 790,122 bytes;
  optimised, they take 520,571. A `yarn test-api` test fails on an image the script would still change, so an unoptimised image
  cannot land. `svgo` and `sharp` become exact-pinned devDependencies, since the output is the same only for one
  version of each.
- `client-v2/static/`, `scripts/update-static.mjs`, `scripts/static-overlay.mjs`, their tests, and
  `scripts/assets-commit.test.mjs` are removed.
- The `client/public` submodule and `.gitmodules` are removed. The upstream `client/` no longer builds; it is not
  deployed and goes with HOO-2686.
- CI, `preview.yml`, and the client-v2 Docker image check out or copy the repository without the submodule and
  without full history.
- `compose.yaml` drops the upstream client's services and the `dev`, `prod`, and `client-standalone` profiles, with
  the `server` and MongoDB `db` services that only those profiles ran.
- The served icons, manifest, and share card copy do not change in content: every file of `public/` that stays
  matches what `update-static.mjs` produced, apart from `index.html`, which goes back to upstream's, and the
  images, which keep their pixels (PNG, SVG) or are re-encoded at `JPEG_QUALITY` (JPEG). The card's URLs name the
  build's site URL instead of `solana-playground-teal.vercel.app`. The Markdown tutorials leave the build; no list
  in the app showed them.
- No slice under `features/` or `widgets/` changes, so no telemetry event is added, renamed, or removed, and no
  funnel step's code changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-build`: the scenarios "The generated head (manual)" and "The generated card tags (manual)" read the
  built page and the dev server's page; "Served icon files are the brand renders (manual)" and "The share image is
  served (manual)" compare `build/` with the tracked `public/` files, instead of the output of
  `scripts/update-static.mjs` and the copies under `client-v2/static/`. "A shared link unfurls as the brand card"
  takes its domain from the build environment, with two new scenarios. A new requirement, "One list enables the
  Markdown tutorials", says which Markdown tutorials the build includes, another, "An upstream sync imports
  only the listed assets", says which upstream assets reach `public/`, and a third, "The images are optimised",
  says the images in `public/` and `src/tutorials/` are kept optimised.

## Impact

- Code: `client-v2/public/`, `client-v2/scripts/` (`assets-import.txt` among them), `client-v2/package.json`
  (`generate`, `generate-fast`), `client-v2/craco.config.js`, `client-v2/src/tutorials/markdown-tutorials.json`,
  `.claude/skills/sync-upstream/`, `client-v2/Dockerfile`, `.dockerignore`, `.gitignore`, `.gitmodules`,
  `compose.yaml`, `.env.example`, `client-v2/.env.example` (`SITE_URL`), `reusable-client-v2.yml`, `preview.yml`,
  and the docs that described the mirror.
- A Vercel build names its production domain in the card only while `VERCEL_PROJECT_PRODUCTION_URL` reaches the
  build; `SITE_URL` overrides it.
- Asset changes from upstream reach `public/` through the `sync-upstream` skill's `assets` command during an
  upstream sync (HOO-2687), which also updates `scripts/assets-commit.txt` and reports each new tutorial folder
  for the user to enable or leave out.
- A new Markdown tutorial adds its own entry to `markdown-tutorials.json`.
- Out of scope: deleting `client/` (HOO-2686), the server's share routes and its MongoDB connection (HOO-2727), and
  any change to `server/`.
