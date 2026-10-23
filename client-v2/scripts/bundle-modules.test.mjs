import assert from "node:assert/strict";
import test from "node:test";

import { offendingModules, slimModules } from "./bundle-modules.mjs";

const STORED_VALUES = "./src/test-utils/stored-values.ts";

// stats.toJson shape: a concatenated module carries its inner modules, which have no chunks of their own
const concatenated = (inner) => ({
  type: "module",
  name: "./src/index.tsx + 2 modules",
  size: 300,
  chunks: ["main"],
  modules: [
    { type: "module", name: "./src/index.tsx", size: 200, chunks: [] },
    { type: "module", name: inner, size: 100, chunks: [] },
  ],
});

// What `all: false` leaves of the orphan modules: a group with a size and no name
const ORPHANS = { type: "orphan modules", size: 1000, filteredChildren: 3 };

test("slimModules lists nested modules with their parent's chunks and drops groups", () => {
  assert.deepEqual(slimModules([concatenated(STORED_VALUES), ORPHANS]), [
    { name: "./src/index.tsx + 2 modules", size: 300, chunks: ["main"] },
    { name: "./src/index.tsx", size: 200, chunks: ["main"] },
    { name: STORED_VALUES, size: 100, chunks: ["main"] },
  ]);
});

test("slimModules throws on a nested module without a name", () => {
  assert.throws(
    () => slimModules([concatenated(undefined)]),
    /stats\.toJson\(\{ modules: true \}\) has no string name/
  );
});

// [module name, whether it is test-only]
const NAMES = [
  [STORED_VALUES, true],
  ["./node_modules/vitest/dist/index.js", true],
  ["./node_modules/@vitest/expect/dist/index.js", true],
  ["./node_modules/foo/node_modules/vitest/dist/index.js", true],
  ["./node_modules/foo/src/test-utils/x.js", false],
  ["./node_modules/vitest-environment-x/index.js", false],
];

for (const [name, offending] of NAMES) {
  test(`offendingModules ${offending ? "names" : "passes"} ${name}`, () => {
    assert.deepEqual(
      offendingModules([{ name, size: 1, chunks: ["1"] }]),
      offending ? [name] : []
    );
  });
}
