# Design

## Context

Read at
[`3c5308d`](https://github.com/hoodieshq/solana-playground/commit/3c5308d86330802478bcabd7aedb8667cb2400fa):
`client-v2` builds with Create React App 5 (`react-scripts` 5.0.0) through
craco 6.4.3. CRA configures one minimizer, a `TerserPlugin` instance
(`terser-webpack-plugin` 5.3.1), which `craco.config.js` reaches into to set
`keep_classnames` and `keep_fnames` to `/^_Pg/`. See proposal.md (Why)
for the memory measurements.

Three facts constrain the approach:

- `terser-webpack-plugin` 5.3.1 ships `esbuildMinify` as an alternative
  implementation behind the same plugin; it `require`s `esbuild` at run time.
  `esbuild` 0.25.9 is installed only as a dependency of `tsx`.
- `src/utils/decorators/common.ts` names each change event
  `"ondidchange" + sClass.name + accessor`. If two decorated classes are
  minified to the same name, their events collide and a derived value that
  depends on another loops forever, in production builds only.
- The browser suite (`yarn test-e2e`) runs against the development server, so
  nothing automated exercises the minified bundle.

## Goals / Non-Goals

**Goals:**

- The minifier change and the removal of the two check plugins live in
  `craco.config.js` and nowhere else in the build.
- A minified bundle that drops the `_Pg` names fails CI.
- Returning to Terser is a revert of one configuration block.

**Non-Goals:**

- Matching Terser's output size. Closing the gap is a future improvement,
  postponed in proposal.md (Impact, Out of scope).
- Changing how chunks are split.

## Decisions

### esbuild through `terser-webpack-plugin`, not a separate plugin

Replace the `minimizer` of CRA's existing `TerserPlugin` instance with
`{ implementation: TerserPlugin.esbuildMinify, options }`. CRA's CSS minimizer
and the rest of the optimization settings stay as they are.

- Alternative: `esbuild-loader`'s `EsbuildPlugin` in place of CRA's minimizer.
  It adds a second package for the same esbuild call and means removing CRA's
  minimizer by index.
- Alternative: SWC (`swcMinify`). It also keeps names only all or none, so the
  size cost of `keepNames` would be similar, and it adds the `@swc/core`
  native binaries. Not measured.

### `keepNames: true`

esbuild has no pattern form of `keep_classnames`, so `keepNames` keeps every
class and function name; its share of the 14.5% increase is not measured. The
alternative, a decorator lookup that does not depend on `Function.name`,
touches every `_Pg*` module in the runtime modules `client-v2/CLAUDE.md` lists
as never moved.

### The target comes from the production `browserslist`

The minifier's `target` is computed in `craco.config.js` by resolving the
`production` `browserslist` entry of `package.json` (the `browserslist`
package is installed through CRA) and taking the lowest version per engine in
`ESBUILD_ENGINES`. The measurement in proposal.md used `es2017`; the floor is
newer, so the output can only get smaller or stay the same.

- Alternative: a literal list in `craco.config.js`. It duplicates the floor,
  which `client-v2-browser-support` in `ui-migration` requires to be stated in
  one place.

### Check plugins removed by class name, in production builds only

In `configure`, when craco's `env` is `production`, filter
`ForkTsCheckerWebpackPlugin`, `ForkTsCheckerWarningWebpackPlugin` (CRA's
variant under `TSC_COMPILE_ON_ERROR=true`), and `ESLintWebpackPlugin` out of
`webpackConfig.plugins`.

- Alternative: `DISABLE_ESLINT_PLUGIN=true`. It covers ESLint only; CRA has no
  switch for the type checker, and craco 6 has no `typescript` option.

### `parallel` stays at 2

The esbuild measurement ran with `parallel: 2`. esbuild's per-call memory is
outside the JavaScript heap and small, so a higher count is likely safe, but
it has not been measured, and the time saved would be a few seconds.

### Bundle guard in CI

A step after `yarn build-fast` in `client-v2.yml` fails unless
`build/static/js` contains both `_PgConnection` and `_PgProgramInfo`. Per
`client-v2/CLAUDE.md`, build configuration is guarded by its outcome, not by a
unit test of `craco.config.js`. The guard must fail on a build with
`keepNames: false`; that run is not recorded in this change.

## Risks / Trade-offs

- [The bundle is about 15% larger gzipped: 14.5% with the `browserslist`
  target, measured at `b1bf2cf`] → Accepted (proposal.md, Why): faster builds
  that fit the standard machine cost less per deploy. Shrinking it is
  postponed.
- [esbuild's minifier transforms code differently from Terser, which CRA ran
  with `comparisons: false` and `inline: 2` to avoid past Terser bugs] → The
  manual scenarios in `client-v2-build` exercise the production build; the
  name guard catches the one known production-only failure.
- [The browser suite does not run on the minified bundle] → Manual smoke of a
  Vercel preview: the `(manual)` scenarios of `client-v2-build`.
- [esbuild needs its platform binary (`@esbuild/linux-x64` on Vercel)] → It is
  an optional dependency of `esbuild` that yarn installs per platform; the
  lockfile carries all of them. Preview `solana-playground-jxgcgt42o` built
  with it at `f94b845a`.
- [`esbuild` drifts from the version `tsx` uses] → Pin it exactly, at the
  version `tsx` installs.

## Migration Plan

1. Land the change. Preview `solana-playground-jxgcgt42o` at `f94b845a` built
   on Vercel's standard machine, and `kgoxgt92k` at `83224b9` built there
   without the build cache.
2. Rollback: restore CRA's Terser `minimizer` and keep `parallel: 2`. That
   configuration was measured at 6.3 GB, so it also fits the machine.

## Open Questions

- How many cores `os.cpus()` reports inside Vercel's build container. It
  decides Terser's worker count only; with esbuild and `parallel: 2` it does
  not matter, but it does for the rollback path if `parallel` is removed.
