# Proposal

## Why

The production build of `client-v2` runs out of memory on Vercel's standard
build machine (8 GB) and is killed with SIGKILL. The cause is Terser, the
minifier Create React App ships with. `terser-webpack-plugin` runs its workers
as threads inside the webpack process (`enableWorkerThreads: true`), one per
core minus one, and every thread has its own V8 heap outside the limit set by
`--max-old-space-size`. Each of the four largest chunks (3.0 to 3.7 MB after
minification) costs about 1.4 GB while Terser holds its syntax tree, and all
four are minified at once. On a 16-core machine the webpack process peaked at
9.6 GB.

Cold production builds, measured once each on the same 16-core machine with
the Vercel `NODE_OPTIONS`:

| Minifier | Time | Peak memory | JS gzip |
| ------------------------------ | ---- | ----------- | -------------- |
| Terser, one worker per core | 55 s | 9.6 GB | 5.43 MB |
| Terser, `parallel: 2` | 67 s | 6.3 GB | 5.43 MB |
| Terser, `compress: false` | 54 s | 5.8 GB | 5.63 MB (+4%) |
| esbuild, `keepNames`, `es2017` | 47 s | 4.6 GB | 6.30 MB (+16%) |

We choose esbuild. It builds fastest and with the least memory, and it moves
the build towards a native toolchain rather than tuning the JavaScript one.
The price is a larger bundle: 16% more gzipped JavaScript in the `es2017`
measurement, and 14.5% with the `browserslist` target that ships (design.md,
Risks). We accept that price for faster builds that fit the standard machine
without Enhanced Builds. The decision is reversible; "Out of scope" names the
fallback.

## What Changes

- The production build minifies JavaScript with esbuild instead of Terser,
  through `terser-webpack-plugin`'s `esbuildMinify`. `esbuild` becomes a direct
  dependency of `client-v2`.
- esbuild keeps every class and function name (`keepNames`). The decorators in
  `src/utils/decorators/common.ts` derive each change-event name from the
  class name of a `_Pg*` class, and esbuild cannot keep names by pattern the
  way Terser's `keep_classnames: /^_Pg/` does.
- esbuild's output targets the production `browserslist` floor, so the
  minifier never emits syntax newer than the browsers the product supports.
- The production build no longer runs the type check
  (`ForkTsCheckerWebpackPlugin`) or ESLint (`ESLintWebpackPlugin`). Both keep
  running in CI (`client-v2.yml`) and in the pre-push hook (`yarn run check`). The
  development server keeps both, so type errors still show in the overlay.
- CI checks the built bundle for the `_Pg*` class names, so a minifier change
  that drops them fails CI instead of reaching users as an infinite loop.
- No slice under `features/` or `widgets/` changes; no telemetry event is
  added, renamed, or removed.

## Capabilities

### New Capabilities

- `client-v2-build`: what the production build of `client-v2` must produce and
  within which limits: the memory it may use, the names minification must
  keep, the browsers its output targets, and where type checking and linting
  run.

### Modified Capabilities

None.

## Impact

- `client-v2/craco.config.js`: the minimizer, the removal of the two check
  plugins in production builds.
- `client-v2/package.json`, `client-v2/yarn.lock`: `esbuild` as a direct
  development dependency.
- `client-v2/src/utils/decorators/common.ts`: the comment on why `_Pg*` names
  must survive minification names Terser's options; the change makes it name
  esbuild's `keepNames`.
- `.github/workflows/client-v2.yml`: a step that checks the built bundle for
  the `_Pg*` class names.
- `.githooks/pre-push`, `CLAUDE.md`, `client-v2/README.md`: `yarn check`
  becomes `yarn run check`. Yarn 1's built-in `check` (it compares
  `node_modules` with `yarn.lock`) shadows the script of the same name, so the
  hook never ran the project's checks, and failed on dependency mismatches
  whatever the code held.
- Users: about 14.5% more gzipped JavaScript to download on first load
  (measured at `b1bf2cf` with the `browserslist` target; 16%, or 0.87 MB, with
  `es2017`). Cached loads are unaffected.
- Developers: a production build no longer reports type or lint errors. They
  are reported by `yarn run check`, the pre-push hook (opt-in per clone), and CI.
- Vercel: preview and production builds fit the standard build machine.
- Out of scope:
  - Shrinking esbuild's output, a future improvement: dropping `keepNames` by
    giving the decorator lookup an explicit key instead of `Function.name`, and
    splitting the largest chunks. Postponed on purpose: the larger bundle is
    accepted because builds that fit the standard machine and finish faster
    cost less per deploy. The measurements in "Why" are the baseline, and
    Terser with a capped worker count stays the fallback.
  - Replacing webpack or Create React App with a native bundler.
  - Changing `--max-old-space-size` in `vercel.json`.
  - Enhanced Builds on Vercel.
  - Source maps: production builds keep `GENERATE_SOURCEMAP=false`.
