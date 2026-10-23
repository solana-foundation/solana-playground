# Tasks

Every task: ticket to file. All tasks land in one pull request, in this order.

## 1. Measuring and diffing

- [x] 1.1 `client-v2/scripts/bundle-info.mjs`: measure `build/static/js/*.js`
      and `build/static/css/*.css` (raw and gzipped bytes), render the totals
      block and the per-chunk table with `formatBytes` and `stabiliseCell`
      ported from the Explorer, anchored on the committed `bench/BUNDLE.md`;
      `node scripts/bundle-info.mjs [output]` writes it, default
      `bench/BUNDLE.md`. `bundle-info.test.mjs` covers rounding at each unit
      boundary, hysteresis within and past one step, the anchor refusing a
      hand-edited cell, and the chunk id taken from the file name. Verify with
      `yarn test-api`.
- [x] 1.2 `client-v2/scripts/bundle-info-diff.mjs`: `report <base> <fresh>
      [label] [committed]` with the tolerance equal to one display step and the
      stale line when `committed` differs from `fresh`. `bundle-info-diff.test.mjs`
      covers a row within tolerance, a row past it, an added and a removed row,
      and the stale line. Depends on 1.1. Verify with `yarn test-api`.

## 2. Build tests

- [x] 2.1 `client-v2/craco.config.js`: a plugin, production builds only, that
      writes `build/bundle-modules.json` from
      `stats.toJson({ all: false, modules: true, nestedModules: true, ids: true })`.
      `client-v2/scripts/bundle-modules.mjs` exports `offendingModules`, which
      matches a module under `src/test-utils/` or from `vitest` or `@vitest/*`;
      `bundle-modules.test.mjs` runs it on a fixture with one nested offending
      module and on a clean fixture. `client-v2/scripts/bundle-modules.build-test.mjs`
      reads the real file, fails when it is absent, and asserts no offender.
      Verify with `yarn test-api`, then `yarn build-fast` followed by
      `yarn test-build`.
- [x] 2.2 `client-v2/scripts/bundle-info.build-test.mjs`: measures `build/`
      through `bundle-info.mjs`, fails when `build/` is absent, and asserts the
      result is byte-identical to `bench/BUNDLE.md`, naming `yarn bundle:info`.
      `client-v2/package.json`: `bundle:info` runs `node scripts/bundle-info.mjs`.
      Generate `client-v2/bench/BUNDLE.md` from a build of the branch's base
      commit and commit it. Depends on 1.1. Verify `yarn build-fast` then
      `yarn test-build` passes, and `yarn bundle:info` on a second build of the
      same commit leaves the file unchanged.

## 3. Workflows

- [x] 3.1 `.github/workflows/reusable-client-v2-build.yml`, `build` job,
      before "Build tests": "Bundle change report" running
      `client-v2/scripts/bundle-info-report.sh "$GITHUB_BASE_REF"` and the
      upload of `build/bundle-report.md` as `bundle-info-comment`, both on
      `github.event_name == 'pull_request'`. Depends on 1.2 and 2.2. Verify on
      the pull request's own run: the step summary holds the report and the
      artifact exists.
- [x] 3.2 `.github/workflows/bundle-info-comment.yml` and
      `client-v2/scripts/bundle-info-locate-pr.mjs`, ported from the Explorer's
      `build-info-comment.yaml` and `build-info-locate-pr.mjs`, on
      `workflow_run` of `client-v2`, artifact `bundle-info-comment`, sticky
      header `bundle-info`; `bundle-info-locate-pr.test.mjs` covers the strict
      head match. Depends on 3.1. Verify on the pull request: one comment
      appears and a second push updates it in place.

## 4. Docs and rule

- [x] 4.1 `client-v2/CLAUDE.md` "Before a PR": a pull request that changes
      bundle sizes refreshes `bench/BUNDLE.md` with `yarn build-fast` then
      `yarn bundle:info` and commits it, and `yarn test-build` fails otherwise;
      "Build configuration is not unit-tested" lists the two new build tests.
      `client-v2/README.md` "Checks" names `bundle:info`; the root `CLAUDE.md`
      command list gains it. Depends on 2.2. Verify `yarn check-md` passes and
      the documented commands run as written.
- [x] 4.2 `docs/testing.md`: B-3 names the two new build tests under
      `test-build`; a new M-7 "the bundle snapshot is current and carries no
      test code" after M-6, modelled on M-6. Depends on 3.1. Verify
      `yarn check-md` passes.

## 5. Proof

- [ ] 5.1 On the pull request: the build job's step summary holds the report
      (on this pull request it says `master` has no snapshot; the sticky
      comment appears from the first pull request after this one merges, since
      `workflow_run` runs the copy on the default branch) and "Build tests"
      passes; a throwaway commit that adds a used static import of
      `src/test-utils/stored-values.ts` to a module fails
      `bundle-modules.build-test.mjs` by name, then is dropped. Depends on 3.2
      and 4.2. Verify from the run logs linked in the pull request description.
