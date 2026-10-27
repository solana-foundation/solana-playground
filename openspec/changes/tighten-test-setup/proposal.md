# Proposal

## Why

The move of the client-v2 unit suite to vitest (HOO-1715, #46) left the test
setup looser than the code it guards: `it.each` runs but fails `yarn
test-types`, the test globals type-check in production code where they throw,
the `PgFs` mock has drifted from `PgFs`, and Node 22's real `BroadcastChannel`
reaches every test that brings no fake. HOO-1914 closes the six points the
review of #46 left open, before HOO-1855 (lifting the TypeScript pin) builds on
the `types` setup.

## What Changes

- A new `tsconfig.app.json` extends `tsconfig.json`, leaves out the test
  files and drops `vitest/globals` from `types`; `tsconfig.json` keeps all of
  `src` and the test globals, for the editor. `yarn test-types` checks both
  programs. A `vi` or `expect`
  in a non-test file fails the check; in-source blocks keep taking the test
  API from `import.meta.vitest`.
- `@types/mocha` is removed. `src/utils/js-runtime/js-runtime.ts` gets a local
  declaration of the part of mocha's browser build it uses, and reads mocha's
  BDD functions off the global object after `mocha.setup`, so no mocha global
  is ambient anywhere. The global `it` is vitest's, `it.each` included.
- `src/test-utils/mock-fs.ts` is checked against `PgFs` with `satisfies`, and
  the drift it shows (`createDir`, `removeDir`, `convertToFullPath`) is fixed.
- `src/setupTests.ts` deletes the global `BroadcastChannel`; a test that needs
  one installs a fake and says so.
- `views/flow/lessons/store.test.ts` ("toasts once") imports the toast module
  before asserting.
- Mock answers that restate what `mockReset` restores are dropped from
  `stage.test.ts`, `tab-sync.test.ts`, `project-sync.test.ts`,
  `tab-reload.test.ts` and `deploy-history.test.ts`.
- The comments and the `AGENTS.md` rule that blame `@types/mocha` for the
  missing `it.each` are corrected.

No slice under `features/` or `widgets/` changes behaviour; no telemetry event
is added, renamed or removed.

## Capabilities

### New Capabilities

### Modified Capabilities

- `client-v2-unit-tests`: adds that the test API is typed only in test code,
  that the global `it` is vitest's, and that tests get no real cross-tab
  channel by default.

## Impact

- Users: none directly. The consequence is for contributors: a stray test
  call in production code fails CI instead of throwing in the browser, and
  `it.each` works where it runs.
- Code: new `client-v2/tsconfig.app.json`,
  `client-v2/package.json` (`test-types`, `@types/mocha` removed),
  `yarn.lock`, `src/utils/js-runtime/js-runtime.ts`, `src/setupTests.ts`,
  `src/test-utils/mock-fs.ts`, the test files named above, `AGENTS.md`.
- The test count is unchanged, plus the tests this change adds, compared name
  for name against the base.
- Out of scope: lifting the TypeScript 5.0.4 pin (HOO-1855); changing what the
  in-browser test runner (`js-runtime`) offers to user programs; the editor
  type definitions shipped for user programs.
