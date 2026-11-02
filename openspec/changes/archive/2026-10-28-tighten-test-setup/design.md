# Design

## Context

See proposal.md, "Why". Today one TypeScript program (`tsconfig.json`, all of
`src`) carries `vitest/globals`, `node` and `vitest/importMeta` in `types`.
`src/utils/js-runtime/js-runtime.ts` does `import * as mocha from "mocha"`,
which resolves to `@types/mocha`; that file declares mocha's `describe`, `it`
and hooks as globals, and its `it` (a `Mocha.TestFunction`, no `each`) is the
one TypeScript picks. `js-runtime.ts` itself uses those globals as free
identifiers after `mocha.setup()` defines them on `window` in the browser.

The webpack build runs no type check of its own over tests, and the new
`tsconfig.app.json` is read by `tsc` alone, so the split changes type
checking only.

## Goals / Non-Goals

**Goals:** the DOD of HOO-1914; one place that decides which files see the
test globals; no mocha type ambient anywhere in the client's programs.

**Non-Goals:** lifting the TypeScript pin (HOO-1855); changing which mocha
globals user programs get in the in-browser runner; the mocha and chai types
the editor offers user programs (shipped separately, not from `@types/mocha`).

## Decisions

### Two programs: `tsconfig.json` with the test globals, `tsconfig.app.json` without

A TypeScript program is one global scope: once any file in it brings in
`vitest/globals`, every file in it sees `vi` and `expect`. So "test globals in
test files only" takes two programs, one of which leaves the test files out.

`tsconfig.json` stays the program over all of `src` and keeps
`vitest/globals`: it is the file the editor, the ESLint import resolver
(`eslint-layers.js`) and the dev server's type checker load, and an editor
opens a test file against the nearest `tsconfig.json` that includes it.
`tsconfig.app.json` extends it, excludes the test code (`src/**/*.test.*`,
`src/**/*.spec.*`, `src/**/__tests__/**`, `src/**/__fixtures__/**`,
`src/setupTests.ts`,
`src/test-utils/**`)
and sets `types` without `vitest/globals`. `test-types` runs
`tsc --noEmit && tsc --noEmit -p tsconfig.app.json`; the second fails on a
`vi` or `expect` in production code. In-source blocks live in non-test files
and take their API from `import.meta.vitest`, so `vitest/importMeta` stays in
both.

Alternative: the ticket's wording, `tsconfig.json` without the globals plus a
`tsconfig.test.json` with them. Rejected because the editor would then open
every test file in an inferred project with no test globals, red throughout,
and the ESLint resolver's project would no longer include the tests. The
outcome the ticket asks for (DOD) is the same either way; only which file
carries the globals differs. Explicit imports of the test API in every test
file would avoid a second program but touch every test file for no
behavioural gain.

### Mocha: the client imports `mocha/browser-entry`, typed locally

`@types/mocha` stays installed: `scripts/generate-packages.mjs` copies it into
the editor's type definitions for user test programs, and `yarn generate`
fails without it. The client's own imports of mocha, in `js-runtime.ts` and in
the generated `package.ts`, name `mocha/browser-entry`: the file webpack picks
for `"mocha"` anyway through the package's `browser` field. That path has no
types, so the ambient `declare module "mocha/browser-entry"` in
`src/utils/js-runtime/mocha.d.ts` applies, declaring only what `js-runtime.ts`
uses (`_state`, `suite`, `setup`, `run`), and `@types/mocha` never enters
either program. The BDD functions `js-runtime.ts` hands to user code are read
off `globalThis` after `mocha.setup()`, typed by a local list of their names,
instead of as ambient globals: the same values from the same place. A name
`mocha.setup` left undefined fails the run naming it, where the old free
identifier threw a `ReferenceError`.

Alternatives, both tried: removing `@types/mocha` breaks `yarn generate`; a
`tsconfig.json` `paths` entry for `"mocha"` worked until webpack and vitest
started resolving runtime imports through `paths`, where it would send the
runtime import to a declaration file. An ambient `declare module "mocha"`
loses to the resolvable `@types/mocha`.

### `BroadcastChannel`

`setupTests.ts` deletes `globalThis.BroadcastChannel`. The two tests that need
one (`tab-sync.test.ts`, `workspace-refresh.test.ts`) already install a fake
with `Object.defineProperty`; any other test that turns out to rely on the
real one gets a fake of its own.

### `PgFs` mock

`mockFsModule`'s object is checked against `Pick<typeof PgFs, ...>` over the
real members it provides, plus the test-only `__files`, with `PgFs` imported as
a type so the check does not load it. The keyword `satisfies` would do it, but
prettier 2.7.1 cannot parse it, so a two-line `satisfies<T>()(value)` helper
(`checkedAs`) does the same check and keeps the mock's own type. The drift the check reports
is fixed in the mock, and so is the drift no signature shows: paths resolve
through `PgExplorer.convertToFullPath` (imported on call, to avoid a cycle),
`removeDir` refuses a non-empty directory unless `recursive` and no longer
removes a directory's namesake siblings, `removeDir` on a file fails with
`ENOTDIR`, and its errors carry lightning-fs's `code` (`ENOENT`, `ENOTDIR`,
`ENOTEMPTY`), which `PgFs.exists` branches on.

## Risks / Trade-offs

- [The second program doubles `test-types` time] → both share the base
  options; measured in the PR.
- [A test silently depended on the real `BroadcastChannel`] → the full unit
  run, compared name for name with the base, shows it.
