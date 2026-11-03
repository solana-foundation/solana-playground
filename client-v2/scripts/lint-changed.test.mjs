import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatReportFor,
  isLintedPath,
  parsePorcelain,
  parsePushedShas,
} from "./lint-changed.mjs";

const lintedPaths = [
  ["client-v2/src/a.ts", true],
  ["client-v2/src/ui/a.tsx", true],
  ["client-v2/api/a.mjs", true],
  ["client-v2/e2e/a.mts", true],
  ["client-v2/scripts/a.mjs", true],
  ["client-v2/eslint-plugin-layers/index.js", true],
  ["client-v2/craco.config.js", false],
  ["client-v2/src-old/a.ts", false],
  ["src/a.ts", false],
  ["client-v2/src/a.ts.orig", false],
];

for (const [file, expected] of lintedPaths) {
  test(`isLintedPath: ${file} is ${expected ? "" : "not "}linted`, () => {
    assert.equal(isLintedPath(file), expected);
  });
}

const formatReport = formatReportFor("/repo");

test("formatReportFor: no messages give an empty report", () => {
  assert.equal(
    formatReport([{ filePath: "/repo/client-v2/src/a.ts", messages: [] }]),
    ""
  );
});

test("formatReportFor: lists every message, then counts by level and rule in sorted order", () => {
  const results = [
    {
      filePath: "/repo/client-v2/src/a.ts",
      messages: [
        {
          line: 3,
          column: 7,
          severity: 1,
          ruleId: "unicorn/no-null",
          message: "No null.",
        },
        {
          line: 9,
          column: 1,
          severity: 2,
          ruleId: "max-params",
          message: "Too many.",
        },
      ],
    },
    {
      filePath: "/elsewhere/b.ts",
      messages: [
        { severity: 2, ruleId: null, message: "Parsing error." },
        {
          line: 1,
          column: 2,
          severity: 1,
          ruleId: "max-params",
          message: "Too many.",
        },
        {
          line: 4,
          column: 2,
          severity: 1,
          ruleId: "unicorn/no-null",
          message: "No null.",
        },
      ],
    },
  ];
  assert.equal(
    formatReport(results),
    [
      "client-v2/src/a.ts:3:7 warn unicorn/no-null No null.",
      "client-v2/src/a.ts:9:1 error max-params Too many.",
      "/elsewhere/b.ts:0:0 error eslint Parsing error.",
      "/elsewhere/b.ts:1:2 warn max-params Too many.",
      "/elsewhere/b.ts:4:2 warn unicorn/no-null No null.",
      "1 error eslint",
      "1 error max-params",
      "1 warn max-params",
      "2 warn unicorn/no-null",
    ].join("\n")
  );
});

const pushes = [
  [
    "two refs, in stdin order",
    "refs/heads/a 1a2b refs/heads/a 0000\nrefs/heads/b 3c4d refs/heads/b 5e6f\n",
    ["1a2b", "3c4d"],
  ],
  ["a deleted ref", "(delete) 0000000000 refs/heads/a 1a2b\n", []],
  ["no input", "", []],
];

for (const [name, stdin, expected] of pushes) {
  test(`parsePushedShas: ${name}`, () => {
    assert.deepEqual(parsePushedShas(stdin), expected);
  });
}

const statuses = [
  ["a modified file", " M client-v2/src/a.ts\0", ["client-v2/src/a.ts"]],
  ["an untracked file", "?? client-v2/src/new.ts\0", ["client-v2/src/new.ts"]],
  [
    "a rename gives the new path and skips the original",
    "R  client-v2/src/new.ts\0client-v2/src/old.ts\0 M client-v2/src/b.ts\0",
    ["client-v2/src/new.ts", "client-v2/src/b.ts"],
  ],
  ["a deletion", " D client-v2/src/gone.ts\0", []],
];

for (const [name, output, expected] of statuses) {
  test(`parsePorcelain: ${name}`, () => {
    assert.deepEqual(parsePorcelain(output), expected);
  });
}
