# Design

## Context

The model is the Solana Explorer's build-size guard
(`scripts/update-build-info.js`, `scripts/build-info-diff.ts`,
`.github/workflows/build-info-comment.yaml`, `bench/BUILD.md`), adapted to
webpack's chunks and to this repository's rule that a check on the bundle is a
build test, not shell in a workflow.

## Decisions

### Every verdict is a build test

`scripts/bundle-info.build-test.mjs` and
`scripts/bundle-modules.build-test.mjs` run under `yarn test-build` and fail
when their input, `build/` or `bundle-info/bundle-modules.json`, is absent. A
workflow step only produces output.
Locally and on CI, `yarn test-build` fails the same way.

- Rejected: the Explorer's `check` subcommand run as a workflow step.

### The snapshot: totals, named rows, and one sum of the other chunks, with a fixed tolerance

`bench/BUNDLE.md` holds JavaScript and CSS totals (count, raw, gzipped) and a
chunk table with a count and a gzipped cell per row. The JavaScript files are
`build/static/js/*.js` and the Monaco workers at the root of `build/`; the
`*.module.wasm` files are left out. `chunkRows` gives a row to each named chunk (`main`, or any name a
`webpackChunkName` adds) and to each worker (`worker:<name>`): a named row
says which part of the app moved. Every other chunk is summed into one
`other chunks` row: webpack names those by a numeric id, which says nothing
about their content. A growth in one lazy chunk still moves the sum.

`formatBytes` rounds as the Explorer does: 10 B under 1 kB, up to the next
10 kB under 1000 kB, 0.01 MB above. A fresh cell within 11 KiB of the committed
cell (`DISPLAY_STEP_TOLERANCE_BYTES`) keeps the committed value, so a rebuild
of the same commit leaves the file unchanged. The report anchors on the base
branch's cells with the same rule.
The rule compares rounded cells, not bytes, so real growth of up to about two
display steps (about 20 KiB for a kB or MB cell) can go unrecorded. A committed
cell that `formatBytes` would not produce does not anchor, so a hand edit in a
form `formatBytes` would not produce fails the freshness test; a hand edit to
another valid cell within the tolerance passes it.

- Rejected: totals only (a regression hides in a total of every file), one row
  per chunk (most rows keyed by ids that name nothing), and exact bytes (a
  rebuild of one commit must leave the file unchanged).

### The module test reads a module list written by craco

`BundleModulesPlugin` in `craco.config.js` writes
`client-v2/bundle-info/bundle-modules.json` on `compiler.hooks.done` from
`stats.toJson({ all: false, modules: true, nestedModules: true,
cachedModules: true })`, flattened by `slimModules` into module names. Only the
module list names a test helper: a helper has no test title for
`in-source-tests.build-test.mjs` to find.

- Outside `build/`: the list (every module path) would otherwise be served by
  every deployment, while `upload-sourcemaps.mjs` deletes the `.map` files so
  module paths do not ship.
- The plugin runs on every production build except Vercel's (`VERCEL` set),
  and removes the list when the build starts. A deployment runs no build test,
  so on Vercel the stats object would only add memory under the build
  machine's limit. A write or stats-shape error is logged, not thrown, so it
  cannot fail the build; the build test then fails on the missing file. It also fails on a list older than `build/index.html`, which a
  build without the plugin leaves.
- `slimModules` throws on a module without a string name, which
  `offendingModules` would otherwise pass as clean, and on a dropped group that
  holds modules.

- `nestedModules: true`: in production, a module concatenated into another
  appears only inside it.
- `cachedModules: true`: CRA's filesystem cache serves most modules on a
  rebuild, and `all: false` leaves cached modules out.
- Rejected: `craco build --stats` (webpack's full stats on every build) and
  source maps (`build-fast` builds without them).

### The comment is posted by a `workflow_run` workflow

The build job, on pull requests only and before "Build tests", writes
`build/bundle-report.md` with `scripts/bundle-info-report.sh` into the step
summary and uploads it as the `bundle-info-comment` artifact. The steps come
before "Build tests" so the report reaches the pull request when the snapshot
is stale; the report then says so. Both steps continue on error with a warning,
so a report failure never skips "Build tests". The report renders `build/`
anchored on the base branch's snapshot, so a row is listed exactly when its
cell moves against the base branch's cell, and on a rebased branch the full
table is the snapshot the pull request commits. Within the tolerance a row
keeps the base cell and is not listed; it is below the snapshot's resolution,
not unchanged. The stale line comes from a separate comparison of the build
with the committed file. The report names the pull request's head commit, and a
run that saves no report replaces the comment with one naming the head and the
run.
`.github/workflows/bundle-info-comment.yml` runs on `workflow_run` of
`client-v2`, finds the pull request with `scripts/lib/bundle/locate-pr.mjs`
(open, same head sha, branch, and repository; the workflow checks out that file
alone, so it imports nothing local), downloads the artifact outside
the workspace, and posts it under the sticky header `bundle-info`. A fork's pull
request runs CI with a read-only token, so the build job cannot post.
`workflow_run` runs the copy of the workflow on the default branch, so the
first comment appears on the first pull request after this change merges.

- Rejected: commenting from the build job.

## Risks / Trade-offs

- A renamed or added named chunk shows as added and removed rows. That is the
  change a reviewer needs to see; the totals stay comparable.
- The comment is posted on every pull request, including one with no size
  change; it updates in place.
- CI measures the merge commit, so the snapshot must be refreshed on a branch
  rebased onto its base. Two pull requests that each move a cell within the
  tolerance can merge green and together move it past it: the push run on
  `master` then fails "Build tests" until someone commits a refreshed snapshot.
- A developer build with `REACT_APP_GA_MEASUREMENT_ID` set, on the command
  line or in `client-v2/.env`, carries tracker code CI's build lacks, so its
  snapshot fails in CI; the docs say to build with the variable set empty,
  which dotenv does not override. Sentry adds no code to a build without
  `VERCEL_ENV`.
- The fork path of `bundle-info-comment.yml` is unverified until a pull
  request from a fork runs it.
