import assert from "node:assert/strict";
import test from "node:test";

import {
  offendingModules,
  slimModules,
  unlistedConcatenatedRoots,
} from "./modules.mjs";

const STORED_VALUES = "./src/test-utils/stored-values.ts";

// stats.toJson shape: a concatenated module carries its inner modules
const concatenated = (inner) => ({
  type: "module",
  name: "./src/index.tsx + 2 modules",
  modules: [
    { type: "module", name: "./src/index.tsx" },
    { type: "module", name: inner },
  ],
});

// What `all: false` leaves of the orphan modules: a group with a size and no name
const ORPHANS = { type: "orphan modules", size: 1000, filteredChildren: 3 };

test("slimModules names nested modules and drops groups", () => {
  assert.deepEqual(slimModules([concatenated(STORED_VALUES), ORPHANS]), [
    "./src/index.tsx + 2 modules",
    "./src/index.tsx",
    STORED_VALUES,
  ]);
});

// [case, stats modules, error]
const MALFORMED = [
  [
    "a nested module without a name",
    [concatenated(undefined)],
    /stats\.toJson\(\{ modules: true \}\) has no string name/,
  ],
  [
    "a dropped group that holds modules",
    [{ type: "orphan modules", modules: [concatenated(STORED_VALUES)] }],
    /"orphan modules" entry .* holds modules/,
  ],
];

for (const [name, modules, error] of MALFORMED) {
  test(`slimModules throws on ${name}`, () => {
    assert.throws(() => slimModules(modules), error);
  });
}

// [case, module names, roots reported]
const CONCATENATED_ROOTS = [
  [
    "a list with nested modules",
    slimModules([concatenated(STORED_VALUES)]),
    [],
  ],
  [
    "a list of outer names only",
    ["./src/index.tsx + 2 modules"],
    ["./src/index.tsx"],
  ],
];

for (const [name, names, roots] of CONCATENATED_ROOTS) {
  test(`unlistedConcatenatedRoots on ${name}`, () => {
    assert.deepEqual(unlistedConcatenatedRoots(names), roots);
  });
}

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
    assert.deepEqual(offendingModules([name]), offending ? [name] : []);
  });
}
