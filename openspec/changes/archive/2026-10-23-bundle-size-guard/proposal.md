# Proposal

## Why

Nothing in `client-v2` recorded the size of the production bundle or told a
reviewer when a pull request changed it. The build tests proved that no
in-source test title reaches a chunk, but a test helper imported statically
ships without a title and passed them.

## What Changes

- `client-v2/bench/BUNDLE.md` is a committed snapshot of the production bundle:
  JavaScript (Monaco workers included) and CSS totals, one gzipped size per
  named chunk and per worker, and one sum of the other chunks.
  `yarn bundle:info` regenerates it from `build/`.
- `yarn test-build` fails when the snapshot is stale
  (`scripts/bundle-info.build-test.mjs`) and when the bundle holds a module
  under `src/test-utils/` or from `vitest` or `@vitest/*`
  (`scripts/bundle-modules.build-test.mjs`).
- `craco.config.js` writes `bundle-info/bundle-modules.json`, the module list
  the second test reads, outside `build/`.
- On a pull request, the build job renders the size change against the base
  branch's snapshot, and `.github/workflows/bundle-info-comment.yml` posts it as
  one sticky comment.

Out of scope:

- A size budget that fails CI on growth.
- Attributing a chunk's growth to an import.
- Measuring the Vercel build (`build:bundle`) or `wasm/build.sh`.

## Impact

- `client-v2/scripts/bundle-*`, `client-v2/scripts/lib/bundle/`,
  `client-v2/craco.config.js`,
  `client-v2/bench/BUNDLE.md`, `client-v2/package.json`, the root
  `.gitignore` (`client-v2/bundle-info/`).
- The Vercel build does not run `BundleModulesPlugin`: no build test reads the
  module list there. Elsewhere the list is written outside `build/`, and an
  error writing it is logged without failing the build.
- `.github/workflows/reusable-client-v2-build.yml` and
  `.github/workflows/bundle-info-comment.yml`.
- `client-v2/CLAUDE.md`, `client-v2/README.md`, `docs/testing.md`, the root
  `CLAUDE.md`.
- A pull request that moves a chunk past the tolerance commits a refreshed
  `bench/BUNDLE.md`, or `yarn test-build` fails and names `yarn bundle:info`.
- No telemetry event is added, renamed, or removed.
