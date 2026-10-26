# client-v2 agent rules

## Sync and persistence: read the gotchas first

Before changing chat storage or project sync, read
[`.claude/rules/project-sync.md`](../.claude/rules/project-sync.md). It records the
invariants of the sync mark, the merge base, the push gate, the tab lock, program
keypairs and diagnostics. Claude Code loads it on its own for the paths in its
frontmatter; other agents read it by hand.

## Tests: no spread for creating new shapes

In test files and in-source test blocks, do not build a new object or array shape by spreading an existing one
(`{ ...base, field: x }`, `[...head, ...tail]`). Prefer an explicit copy that names every field, or
derive the new instance with lenses (`ramda`'s `lensProp`/`set`/`over`, or a similar tool). A spread
hides which fields the fixture actually carries; the explicit form names the change. Build long
event series with small named helpers rather than inline spreads.

Production code is not covered by this rule yet — match the surrounding idiom there.

Note: no lens library is a dependency yet — until one is added, write the explicit copy.

## Tests: a module's unit tests live in the module

A unit test that exercises one module and calls no `vi.mock` of its own (the mocks in
`src/setupTests.ts` apply to every test) sits at the end of that module, in Vitest's in-source block:

```ts
const toSlug = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "-");

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/slug", () => {
    it("toSlug joins words with a dash", () => {
      expect(toSlug(" Hello World ")).toBe("hello-world");
    });
  });
}
```

A test keeps its own `*.test.ts` file when it calls `vi.mock`, renders React
(`@testing-library/react`, `createRoot`), drives several modules together, tests a `.mjs` module
(`node --test`), tests a runtime module the UI move rule never touches (`src/utils/explorer`,
`src/commands/`), re-imports its module after `vi.resetModules()` (the block would run again
mid-test), tests a module the Playwright suite (`e2e/`) imports (Playwright compiles it as CommonJS,
where `import.meta` is a syntax error; its tests live in `<name>.test.mts`, the extension marking the
exception), or is a second test file for a module and its file-scope hooks must not apply to the
first.

Inside a block:

- Take the test API from `import.meta.vitest`, `vi` included, and never the global `it`:
  `@types/mocha` declares that global without `each`, because `src/utils/js-runtime` imports mocha.
- Put the tests under one `describe` named after the module path from `src/` without extension
  (`features/persistence/model/project-id`), with the block's hooks and helpers inside it: vitest's `fullName` carries no
  file path, so the `describe` is what names the module in a failure.
- Do not add or widen a static import of the module for a test. A value from another module is
  loaded in `beforeAll` into a `let` typed as `typeof import("./other").name`; a type is an inline
  `import("./other").Name` alias. The diff of a module that gains a block is the block alone, with
  one exception: a one-line change to a comment that named the deleted test file. A
  synchronous `require()` of an untyped module may stay at block top, as the Monaco internals in
  `editor-buffers.ts` do, because webpack never walks the dead branch; everything imported with
  `import()` goes through `beforeAll`.
- No top-level `await`. The production build runs `src/settings` and its imports through `tsx`,
  whose CommonJS output (esbuild `format: cjs`, because `package.json` has no `type: module`)
  rejects it.
- Do not export a symbol so a test can import it. The block sees the module's unexported
  declarations.
- A value loaded in `beforeAll` is read only inside `it`, a hook, or a function those call; never
  in a `describe` body, an `it.each` table, at block top, or as a hook argument passed by reference
  (`beforeEach(reset)`), where it is still `undefined`.

The text `import.meta.vitest` makes a file a test file (`includeSource` in `vitest.config.ts`).
Write it only where a block follows, never in a comment of a module without tests: `yarn test-unit`
fails such a file with "No test suite found". A block runs only when its file is the entry:
`yarn test-unit src/features/persistence/model/project-id.ts` runs that module's tests, and the
deleted `*.test.ts` path finds nothing. webpack drops the block on its own; `scripts/in-source-tests.build-test.mjs` checks the
built chunks for every block's test titles, and `scripts/in-source-collection.test.mjs` checks that
vitest collects every block.

See [Vitest in-source testing](https://vitest.dev/guide/in-source).
