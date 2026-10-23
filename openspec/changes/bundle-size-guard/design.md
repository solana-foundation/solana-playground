# Design

## Context

See proposal.md, "Why". Read at `c91fab97`:

- The production build is Create React App 5 through craco 6
  (`client-v2/craco.config.js`, minifier options in
  `client-v2/scripts/esbuild-minify.mjs`). `yarn build-fast` writes
  `client-v2/build/static/js/`: `main.<hash>.js` and `<id>.<hash>.chunk.js`,
  206 files, 24,220,413 raw bytes and 6,404,434 gzipped at `39628e59`.
  webpack's production defaults set `optimization.chunkIds` and
  `optimization.moduleIds` to `deterministic`, so a chunk id names the same
  group of modules across builds until the split points move.
- `.github/workflows/reusable-client-v2-build.yml` holds the production build
  in its `build` job: "Production build", two greps ("Check Tailwind is in the
  built CSS", "Check decorator class names survive minification"), then
  "Build tests", which is `yarn test-build`, `node --test
  "scripts/*.build-test.mjs"`. `client-v2.yml` calls it with `uses:` on pushes
  and pull requests to `master`.
- The build tests are the pattern for a verdict on the bundle:
  `scripts/in-source-tests.build-test.mjs` greps the chunks for in-source
  test titles, `scripts/chunk-scope.build-test.mjs` parses them for top-level
  declarations; both fail when `build/` is absent. `client-v2/CLAUDE.md`,
  "Build configuration is not unit-tested", names them. The user's rule from
  the review of #101: a check is a script that runs as a test and requires
  the build, not shell in YAML.
- `openspec/specs/client-v2-build/spec.md` already requires "The production
  bundle carries no in-source test code", checked by title. That requirement
  cannot see a module: a test helper imported statically ships code whose
  strings are not test titles.
- The Explorer's tool is the model: `scripts/update-build-info.js` (rounding,
  hysteresis against the committed table), `scripts/build-info-diff.ts`
  (`report` and `check`, an 11 KiB tolerance equal to one display step),
  `scripts/build-info-report.sh`, `.github/workflows/build-info-comment.yaml`
  (`workflow_run`, sticky comment under the header `build-info`, artifact
  downloaded outside the workspace) and `bench/BUILD.md`.
- craco's `build` script requires react-scripts' `scripts/build.js` in the
  same process after removing its own arguments, so `--stats` would reach
  react-scripts and write `build/bundle-stats.json` with webpack's full
  `toJson()`: every module with its reasons, no `source`. CRA documents that
  file for `webpack-bundle-analyzer`.

## Goals / Non-Goals

**Goals:**

- A reviewer sees a bundle size change on the pull request without building
  anything.
- Every verdict is a build test under `yarn test-build`; a workflow step only
  produces output.
- The checks run on CI's own build, so a laptop build is never the arbiter.
- No new npm dependency; `zlib` and `fs` measure the files.
- The module test names the offending module, not only that one exists.

**Non-Goals:**

- A size budget or a failing threshold on growth.
- Attributing a chunk's growth to an import.
- Measuring the Vercel build, which runs `build:bundle` with source maps.

## Decisions

### Per-chunk rows keyed by chunk id, with totals above them

The snapshot holds a totals block (JavaScript: file count, raw bytes, gzipped
bytes; CSS: the same) and one row per `build/static/js/*.js` keyed by the
chunk id, which is the file name without its hash (`main`, `9859`). Row cells
are gzipped sizes, rounded and stabilised as the Explorer does.

- Alternative: totals only. A regression inside one lazy chunk hides in a
  24 MB total; one display step of the total is larger than many chunks.
- Alternative: the largest N chunks. The cut-off moves between builds, so a
  chunk entering or leaving the top N reads as added or removed and the
  report lies about the change.
- The cost of per-chunk rows is a 206-row table and rows that appear or
  disappear when webpack re-splits. The report shows only rows that moved by
  more than one step and folds the full table into a collapsed section, and
  an added or removed row is what a reviewer should see when split points
  move.

### Rounding and hysteresis copied from the Explorer

`formatBytes` (nearest 10 B under 1 kB, ceiling to 10 kB under 1000 kB,
0.01 MB above) and `stabiliseCell` (keep the committed cell while fresh bytes
are within 11 KiB of it) are ported as they are, with their tests, and the
diff's tolerance is the same constant, so a cell changes only when the bytes
moved past one display step. Totals use the same functions, so the
JavaScript total changes in 0.01 MB steps.

- Alternative: exact bytes. Two builds of the same commit differ by a few
  bytes when a hash or a local name changes (chunk `9859` of #101 differed by
  24 bytes at equal length), so exact cells flap.

### A verdict is a build test; a workflow step only produces output

`scripts/bundle-info.build-test.mjs` imports the measuring functions from
`scripts/bundle-info.mjs`, measures `build/`, renders the table anchored on
the committed `bench/BUNDLE.md`, and asserts byte equality with that file; its
message names `yarn bundle:info`. `scripts/bundle-modules.build-test.mjs`
reads `build/bundle-modules.json` and asserts that `offendingModules` from
`scripts/bundle-modules.mjs` returns nothing. Both fail when their input is
absent, as `chunk-scope.build-test.mjs` does. The pure functions (rounding,
hysteresis, table parsing, diffing, the module matcher) have `.test.mjs`
files under `yarn test-api`, so they run without a build.

- Alternative: the Explorer's shape, a `check` subcommand run as a workflow
  step. Rejected by the repository's rule; it also leaves the local developer
  without a command that fails the same way CI does, where `yarn test-build`
  is already that command.

### The module test reads a slim module list written by craco

A plugin in `craco.config.js`, added only when craco's `env` is
`production`, taps `compiler.hooks.done` and writes `build/bundle-modules.json`
from `stats.toJson({ all: false, modules: true, nestedModules: true, ids:
true })`: module name, size, and chunk ids, nested modules included.
`offendingModules` matches a name under `src/test-utils/` or under
`node_modules/vitest/` or `node_modules/@vitest/`.

- The plugin stays although `in-source-tests.build-test.mjs` already greps
  the chunks: that test matches test titles, which are strings, and a test
  helper imported statically (`src/test-utils/stored-values.ts` exports
  functions, no titles) ships without one. Only webpack's module list carries
  the path.
- `nestedModules: true` matters: in production, `ModuleConcatenationPlugin`
  folds ES modules into one concatenated module, and a helper imported
  statically would otherwise appear only as part of its importer's name.
- Alternative: `craco build --stats`. It passes through to react-scripts, but
  writes the full `toJson()` with every module's reasons for every production
  build, a file CRA sizes for a bundle analyser, not for a test. Not measured
  here; the slim list is one order of magnitude smaller by construction.
- Alternative: source maps. `build-fast` sets `GENERATE_SOURCEMAP=false`, and
  hidden maps exist only on Sentry builds, so the test would need its own
  build.

### Two workflow steps before "Build tests", on pull requests only

In the `build` job of `reusable-client-v2-build.yml`, after "Check decorator
class names survive minification" and before "Build tests":

1. "Bundle change report", `if: github.event_name == 'pull_request'`:
   `scripts/bundle-info-report.sh "$GITHUB_BASE_REF"` measures `build/` to
   `build/BUNDLE.fresh.md` with `scripts/bundle-info.mjs`, fetches the base
   branch's `client-v2/bench/BUNDLE.md`, renders `build/bundle-report.md` with
   `scripts/bundle-info-diff.mjs report`, and appends it to
   `$GITHUB_STEP_SUMMARY`. Inside a reusable workflow, `github.event_name` and
   `GITHUB_BASE_REF` are the caller's.
2. `actions/upload-artifact` of `build/bundle-report.md` as
   `bundle-info-comment`, same condition.

The steps sit before "Build tests" because the report must reach the pull
request when the freshness test fails: that is the run in which the developer
needs the numbers. The Explorer reaches the same end by putting its gate last;
here the gate is inside `yarn test-build`, so the report moves ahead of it
instead. The report carries a line saying the snapshot is out of date when the
fresh table differs from the committed one, as the Explorer's `stale` flag does.

`.github/workflows/bundle-info-comment.yml` runs on `workflow_run` of the
`client-v2` workflow (the caller; the artifact belongs to its run), checks out
only `client-v2/scripts/bundle-info-locate-pr.mjs` from the default branch,
downloads the artifact outside the workspace, and posts it with
`marocchino/sticky-pull-request-comment` under the header `bundle-info`. The
split from the build workflow is the Explorer's reason: a fork's pull request
runs CI with a read-only token.

- Alternative: comment from the `build` job. Fails on forks, and the job
  would need `pull-requests: write`.

### The snapshot lives in `client-v2/bench/`

Mirrors the Explorer's `bench/BUILD.md`, beside the package it measures;
`client-v2/docs/` holds prose, not generated tables.

## Risks / Trade-offs

- [A laptop build and CI's build round differently for one chunk] → The test
  compares CI's build with the committed file; the developer refreshes with
  `yarn bundle:info` on their build. If a platform difference exceeds one
  step for a chunk, that chunk's row flaps; the fix is to widen the display
  step for rows, recorded as an open question.
- [webpack re-splits chunks and the table shows many added and removed rows]
  → Truthful: the split changed. Totals stay comparable.
- [The sticky comment posts on every pull request, including ones with no
  size change] → Same as the Explorer; the comment updates in place and says
  "no chunk size changed".
- [The `workflow_run` workflow runs with write permission on fork-controlled
  input] → The artifact is downloaded outside the workspace and only the
  locate script is checked out, as in the Explorer.
- [`yarn test-build` now needs `build/bundle-modules.json`, so a build made
  by another path than `craco build` fails the module test] → The test's
  message names the file and the plugin; `build-fast` and `build:bundle` both
  run `craco build`.

## Migration Plan

1. Land the change with `bench/BUNDLE.md` generated from a build of the base
   commit, so the first pull request after it reports against a true base.
2. Rollback: remove the two workflow steps, the comment workflow and the two
   build tests; the scripts and the snapshot are inert without them.

## Open Questions

- Whether a 10 kB row step is enough once chunks are measured on CI's runner;
  settled by the first weeks of reports.
