# Proposal

## Why

A unit test of a `client-v2` module lives in a separate `*.test.ts` file, so a
test of a function the module does not export has two options: export the
function, which widens the module's contract for the test alone, or leave it
untested. Rust keeps unit tests beside the code in `#[cfg(test)] mod tests`.
Vitest offers the same shape: a block guarded by `import.meta.vitest` at the end
of the module, run by the test runner and dropped by the production build. The
setup for that block does not exist yet, and every unit test that could use it
sits in a file. Adding the setup together with the move of the tests that fit
makes the block the ordinary place for a unit test, not an exception.

## What Changes

- The unit suite collects in-source test blocks from `src/**/*.{ts,tsx}` in
  addition to the test files matched by `include`.
- The 51 unit test files whose tests exercise one sibling module and mock no module move
  into that module's block. Test bodies and titles are unchanged; each block
  gains one outer `describe` named after the module path from `src/`, so a
  failure names the module. Five
  declarations change form because helpers are loaded after collection:
  `beforeEach(clearFailures)` and `afterEach(clearFailures)` in the merge
  tests become arrow functions, and three `const` fixtures in the chat-sync
  tests (`mockFiles` in two `describe` bodies, `accountThread`) become `let`
  bindings assigned in a `beforeAll` (design.md, "Helpers load in
  `beforeAll`").
- Two modules that `e2e/` imports keep their tests in `<name>.test.mts`
  files instead of a block: `shared/lib/ids` and
  `features/persistence/ui/merge-editor/hunk-class`. Playwright compiles a
  `.ts` under a CommonJS package as CommonJS, where `import.meta` is a syntax
  error, so a block in a module the browser suite loads, directly or through
  the imports of its imports, fails the e2e job at load (design.md, "Modules
  the Playwright suite imports"). The `.mts` extension marks the exception.
  A module the suite needs only a constant from exposes it through a leaf
  instead of losing its block: `views/sidebar/assistant/model/remembered-backend`
  keeps its block and re-exports `REMEMBERED_BACKEND_KEY` from
  `remembered-backend-key.ts`, which the suite imports.
  `scripts/in-source-e2e-imports.test.mjs` fails `yarn test-api` when an
  `e2e/` file loads a module with a block.
- Tests that stay files: every test that uses `vi.mock`, every React component
  and hook test, the integration tests, `setupTests.test.ts`, the tests of
  `.mjs` modules under `features/api/server/`, the tests of the runtime modules
  `utils/explorer` and `commands/deploy`, the tests of modules `e2e/` imports,
  `constants/__tests__/connection.test.ts` (it re-imports its module after
  `vi.resetModules()`), and `features/auth/model/telemetry.test.ts` (a second
  file for `session.ts` with file-scope hooks).
- `client-v2/AGENTS.md` gains the rule: which tests live in-source, which stay
  files, the block pattern, and what a block must not do. The rule supersedes
  the one drafted on the `docs/in-source-unit-tests` branch, which assumed a
  `DefinePlugin` entry and moved no existing test.
- The build tests check the production bundle after `yarn build-fast`:
  `scripts/in-source-tests.build-test.mjs` collects every block's test titles
  and fails when one is in `build/static/js`;
  `scripts/in-source-collection.test.mjs` fails `yarn test-api` when vitest
  does not list a module that holds a block.
- `tsconfig.json` types `import.meta.vitest` through `vitest/importMeta`. The
  ESLint exemption for `src/shared/lib/ids.test.ts` follows the file to
  `src/shared/lib/ids.test.mts`; `vitest.config.ts`, the `lint` script, and
  the ESLint overrides accept `.mts` test files.
- `client-v2/CLAUDE.md`, the root `CLAUDE.md`, `client-v2/README.md`, and
  `docs/testing.md` describe the in-source layout and the CI check.
- No slice under `features/` or `widgets/` changes behaviour. No telemetry
  event is added, renamed, or removed.

## Capabilities

### New Capabilities

- `client-v2-unit-tests`: where a module's unit tests live, what an in-source
  test block may contain and must not do, and how the unit suite collects test
  files and blocks.

### Modified Capabilities

- `client-v2-build`: the production bundle carries no in-source test code, and
  CI fails when it does.

## Impact

- `client-v2/vitest.config.ts`, `client-v2/tsconfig.json`,
  `client-v2/package.json` (`eslintConfig`): the setup.
- 51 modules under `client-v2/src` gain an appended block; 51 test files are
  deleted and two are renamed to `.test.mts`. The modules' import lists are
  unchanged, except that `remembered-backend.ts` takes its storage key from
  the new leaf `remembered-backend-key.ts`.
- `client-v2/scripts/`: the three node tests and their helper.
- `client-v2/AGENTS.md`, `client-v2/CLAUDE.md`, `CLAUDE.md`,
  `client-v2/README.md`, `docs/testing.md`.
- Users: nothing visible. The production bundle is checked to carry no test
  code, and the dead block leaves no residue after minification.
- Developers: a failing test in a module is re-run with the module's path,
  `yarn test-unit src/features/persistence/model/project-id.ts`; the old test
  path finds nothing.
  `it.each` type-checks inside a block, because `it` is destructured from
  `import.meta.vitest` and not read from the global that `@types/mocha`
  declares (HOO-1914 reports the global).
- Out of scope:
  - Moving tests that use `vi.mock`. Whether a module mock inside a block is
    hoisted correctly is unverified, and such a test is not a unit test of the
    module alone.
  - Moving React component and hook tests or integration tests. Vitest's own
    guidance keeps them in files.
  - Trimming tests while moving them. The move is mechanical; the test count
    is unchanged name for name.
  - The rest of HOO-1914: a `tsconfig.test.json` that hides `vitest/globals`
    from production code, the `mock-fs` typing, the `BroadcastChannel` global.
  - Keeping the six modules that pass 1000 lines after the move
    (`views/sidebar/assistant/store.ts`, `utils/common.ts`,
    `features/persistence/model/merge.ts`,
    `features/persistence/ui/merge-editor/merge-file.ts`,
    `features/persistence/model/chat-sync.ts`, `views/flow/lessons/ledger.ts`)
    as files. They move with the rest; moving any of them back is a revert of
    one module and one file and needs no rule change.
