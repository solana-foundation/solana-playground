# Proposal

## Why

Nothing in `client-v2` records how large the production bundle is or tells a
reviewer when a pull request changes it. The build tests under `yarn test-build`
prove that no in-source test title and no top-level declaration reaches a
chunk; none of them measures a byte. The in-source unit tests of
hoodieshq/solana-playground#101 were checked by hand against a build of the base
commit (24,220,413 raw bytes before and after at `39628e59`), and that check
exists only in a chat transcript. The Solana Explorer repository keeps a
committed route-size table, fails CI when a pull request leaves it stale, and
posts the difference on every pull request; `client-v2` gets the same guard,
adapted to webpack's chunks and to this repository's rule that a check is a
script run as a test, plus a check that no test-only module reaches the bundle.

## What Changes

- `client-v2/bench/BUNDLE.md` is a committed snapshot of the production bundle:
  totals for JavaScript and CSS (file count, raw and gzipped bytes) and one row
  per chunk with its gzipped size, keyed by webpack's chunk id. Cells are
  rounded to the step the Explorer uses and keep their previous value while a
  fresh build rounds within one step of it.
- `yarn bundle:info` regenerates the snapshot from an existing `build/`. The
  rule in `client-v2/CLAUDE.md`: a pull request that changes bundle sizes
  refreshes `bench/BUNDLE.md` and commits it.
- Two build tests join `yarn test-build`, which reads `build/`:
  `scripts/bundle-info.build-test.mjs` fails when the committed snapshot is
  not byte-identical to a fresh measurement and names `yarn bundle:info`;
  `scripts/bundle-modules.build-test.mjs` fails when the bundle holds a module
  under `src/test-utils/` or from `vitest` or `@vitest/*`, naming the module.
- `craco.config.js` writes `build/bundle-modules.json` in production builds, a
  slim list of module names, sizes and chunk ids, which the module test reads.
- The `build` job of `.github/workflows/reusable-client-v2-build.yml` renders,
  on pull requests, the change against the base branch's committed snapshot
  into the step summary and an artifact. A `workflow_run` workflow posts that
  artifact as one sticky comment on the pull request, so a fork's read-only
  token cannot block it.
- No slice under `features/` or `widgets/` changes; no telemetry event is added,
  renamed, or removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-build`: the production bundle has a committed size snapshot that
  the build tests keep current, a pull request receives its size change as a
  comment, and the bundle carries no test helper or test runner module.

## Impact

- `client-v2/scripts/`: `bundle-info.mjs` and `bundle-info-diff.mjs` (the
  measuring, rounding and diffing functions, each with a `.test.mjs` under
  `yarn test-api`), `bundle-modules.mjs` (the matcher, with its `.test.mjs`),
  `bundle-info.build-test.mjs` and `bundle-modules.build-test.mjs` (under
  `yarn test-build`), `bundle-info-report.sh` and `bundle-info-locate-pr.mjs`
  (used by the workflows). No new npm dependency: sizes come from `zlib` and
  `fs`.
- `client-v2/craco.config.js`: one plugin that writes `build/bundle-modules.json`.
- `client-v2/bench/BUNDLE.md`: the first snapshot, generated from a build of
  the base commit.
- `client-v2/package.json`: the `bundle:info` script.
- `.github/workflows/reusable-client-v2-build.yml`: two steps in the `build`
  job; `.github/workflows/bundle-info-comment.yml`: the comment workflow.
- `client-v2/CLAUDE.md`, `client-v2/README.md`, `docs/testing.md` (B-3 and a
  new M-7), the root `CLAUDE.md` command list.
- Users: nothing visible. A size regression is seen on the pull request instead
  of after a deploy.
- Developers: a pull request that changes any chunk beyond one rounding step
  carries a refreshed `bench/BUNDLE.md`, or `yarn test-build` fails with the
  command to run; locally the file is refreshed after `yarn build-fast`.
- Out of scope:
  - A size budget that fails CI on growth. The snapshot makes growth visible;
    deciding what is too much is a later change.
  - Per-module attribution of a change (which import grew a chunk). The
    module list this change writes makes that a later script, not a build
    change.
  - Agadoo-style tree-shaking checks on single modules. They fit a library
    entry point with no side effects; `client-v2` modules register singletons
    and decorators by design, and the `import.meta.vitest` guard reads as a
    side effect to Rollup.
  - The Vercel build (`build:bundle`) and `wasm/build.sh`: untouched.
