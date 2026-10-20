import assert from "node:assert/strict";
import test from "node:test";

import { blockTitles, isTestFile } from "./in-source-titles.mjs";

const guard = (body) =>
  `export const x = 1;\n\nif (import.meta.vitest) {\n${body}\n}\n`;

// [module text, expected titles]: one row per branch of `blockTitles`
const CASES = [
  [guard('  it("a plain title", () => {});'), ["a plain title"]],
  [
    guard('  it.each([\n    [1, 2],\n  ])("an each title %s", () => {});'),
    ["an each title %s"],
  ],
  [guard("  it(`a ${kind} title`, () => {});"), []],
  [
    guard(
      '  describe("shared/lib/ids", () => {\n    it(\n      "a title on its own line",\n      () => {}\n    );\n  });'
    ),
    ["a title on its own line"],
  ],
  [
    `it("before the guard", () => {});\n${guard(
      '  it("after the guard", () => {});'
    )}`,
    ["after the guard"],
  ],
  ["export const x = 1;\n", []],
];

for (const [text, expected] of CASES) {
  test(`blockTitles finds ${JSON.stringify(expected)}`, () => {
    assert.deepEqual(blockTitles(text), expected);
  });
}

// [path, is a test file]
const PATHS = [
  ["src/shared/lib/ids.ts", false],
  ["src/shared/lib/ids.test.ts", true],
  ["src/features/agent/agent.integration.spec.ts", true],
  ["src/constants/__tests__/connection.test.ts", true],
  ["src/settings/__tests__/create.ts", true],
];

for (const [file, expected] of PATHS) {
  test(`isTestFile(${file}) is ${expected}`, () => {
    assert.equal(isTestFile(file), expected);
  });
}
