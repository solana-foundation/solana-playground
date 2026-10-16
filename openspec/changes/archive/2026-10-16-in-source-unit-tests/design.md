# Design

## Context

Read at `472ed30f` (`master-2.0`). `client-v2` runs its unit suite with vitest
5.0.3 (`vitest.config.ts`: `globals: true`, jsdom, `src/setupTests.ts`,
`mockReset: true`, CRA's `testMatch` as `include`). The production build is
Create React App 5 (`react-scripts` 5.0.0, webpack 5.71.0) through craco 6.
`tsconfig.json` has `module: esnext`, `target: es2020`, and
`types: ["vitest/globals", "node"]`. The suite holds 122 files and 1512 tests.

Four facts shape the approach:

- webpack 5.71.0 drops the block unaided. `ImportMetaPlugin` evaluates an
  unknown `import.meta.<x>` to `undefined` with no side effects, `ConstPlugin`
  replaces the `if` test with `false`, and `JavascriptParser.walkIfStatement`
  does not walk the dead branch. Nothing inside the block reaches a webpack
  hook: no `require`, no `import()`, no `await`.
- `craco.config.js` executes `yarn run tsx src/settings` at build time to
  define `GLOBAL_SETTINGS`. tsx compiles each `.ts` with esbuild in `cjs`
  format, which turns `import.meta.vitest` into a property of an empty object
  and rejects a top-level `await` as a hard error. Fifteen of the modules that
  gain a block are in that graph.
- vitest's `includeSource` match is textual: a file is collected when its
  source contains `import.meta.vitest`, comments included. The block runs only
  when the file is the test entry (`getCurrentTestFilepath() === module.file`),
  so importing module A from module B's block does not run A's block.
- `src/utils/js-runtime/js-runtime.ts` imports mocha, so `@types/mocha`
  declares a global `it` without `each` (HOO-1914). `vitest/importMeta` types
  `import.meta.vitest` as `typeof import("vitest")`.

## Goals / Non-Goals

**Goals:**

- A module's unit tests sit in the module; the module's import list is
  unchanged by the move.
- A block that reaches the bundle fails CI.
- The test count is unchanged name for name, proven by a reporter diff.

**Non-Goals:**

- Moving tests that mock modules, render React, or span modules
  (proposal.md, Impact).
- Changing `mockReset`, `globals`, or the environment of any test.

## Decisions

### No `DefinePlugin` entry

webpack removes the block through its own `import.meta` evaluation (Context).
The `docs/in-source-unit-tests` branch assumed a `DefinePlugin` entry; one
would be a second mechanism for the same effect and would hide whether the
first one still holds. CI guards the outcome instead ("Three test titles
guard the bundle"), per
`client-v2/CLAUDE.md` "Build configuration is not unit-tested".

### Helpers load in `beforeAll`, never with a top-level `await`

A block that needs a value beyond the module's own declarations and its
existing value imports declares `let x: typeof import("mod").x;` and assigns it
in `beforeAll(async () => { ({ x } = await import("mod")); })`. Types come as
inline `import("mod").X` aliases.

- Alternative: a top-level `await import()` inside the block. tsc, babel,
  webpack, and vitest accept it; tsx's `cjs` transform rejects it, and the
  production build runs tsx over fifteen of the target modules.
- Alternative: a static import of the helper. That widens the module's import
  list for the test and bundles the helper.

Consequence: a hook argument passed by reference at collection time captures
`undefined`. The five places in the moved tests where that happens change
form: `beforeEach(clearFailures)` and `afterEach(clearFailures)` in the merge
tests become arrow functions, and three `const` fixtures in the chat-sync
tests (`mockFiles` in two `describe` bodies, `accountThread`) become `let`
bindings assigned in a `beforeAll` of the same `describe`.

### The test API is destructured, never the global

`const { describe, it, expect, vi } = import.meta.vitest;` at the top of the
block. TypeScript narrows `import.meta.vitest` inside the `if`, so no `!` is
needed. The local `it` is vitest's and has `each`; the global `it` is mocha's
(Context) and does not.

### Two sibling tests stay files

- `constants/__tests__/connection.test.ts` calls `vi.resetModules()` and
  re-imports `../connection`. In-source, the re-import is of the entry file,
  so the block runs again and registers tests during a running test.
- `features/auth/model/telemetry.test.ts` is a second test file for
  `session.ts` with `beforeEach`/`afterEach` at file scope; merged into one
  block, those hooks would apply to the session tests too. It can move later
  as a second `describe` whose hooks sit inside it.

### Three test titles guard the bundle

The CI step greps `build/static/js/*.js` for three test titles, one each from
`shared/lib/ids.ts`, `features/persistence/model/project-id.ts`, and
`widgets/layout-shell/model/layout-state.ts`, and first requires each title in
a non-test file under `src/` that holds the guard text, so a title that moves
back into a `*.test.ts` file, which is never bundled, fails the step instead
of emptying it. Titles rather than `describe(` or `it(`: `js-runtime.ts`
bundles mocha, so the function names are in the bundle legitimately. The block
of `hunk-class.ts` imports `fs` and `path` dynamically, so a build that stopped
dropping blocks would already fail on "Can't resolve 'fs'" before the title
grep runs.

### The marker string is reserved

Because the match is textual, the rule forbids `import.meta.vitest` in a
comment of a module without a block: vitest collects the file and fails with
"No test suite found". Prose about the block names it as "the in-source
block" or "the `import.meta.vitest` guard" inside Markdown only.

## Risks / Trade-offs

- [Six modules pass 1000 lines after the move] → Accepted (proposal.md,
  Impact): one rule with no size exception. Moving one back is one module and
  one file.
- [`mockReset: true` resets a `vi.fn()` created at block top before every
  test] → Unchanged behaviour: the same reset applied to module-level mocks in
  the test files.
- [A later edit adds a static import to a module for its tests] → The rule
  and review; `CircularDependencyPlugin` and the boundary check see the static
  graph, which the move leaves untouched.
- [A block in a module the dev server hot-reloads] → A test edit reloads the
  module; harmless. ForkTsChecker and ESLint already covered test files under
  `src`, so the dev overlay reports the same errors as before.
- [Blame on a moved test points at this change] → `git log --follow` on the
  deleted path keeps the file's history; one commit per batch keeps the move
  readable.

## Migration Plan

1. Before the first move, record `yarn test-unit --reporter=json` and the
   sorted list of `fullName`s with multiplicities.
2. Land the setup with one module (`shared/lib/ids.ts`): it is in the tsx
   graph, in the layered ESLint override, and a CI marker, so one module
   proves the three mechanisms.
3. Move the batches; after each, `yarn test-types`, `yarn lint`,
   `yarn check-format`, `yarn test-unit`.
4. After the last batch, record the same report; the `fullName` lists are
   identical and the file count is unchanged (each moved file is replaced by
   its module as an entry).
5. Rollback: a moved test is restored by cutting its block back into a
   `*.test.ts` file with the import lines; the setup can stay.
