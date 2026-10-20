import assert from "node:assert/strict";
import test from "node:test";

import { topLevelName } from "./top-level-declaration.mjs";

// [script, expected name]: one row per branch of `topLevelName`
const CASES = [
  [
    'var a=Object.defineProperty,b=(c,d)=>a(c,"name",{value:d,configurable:!0});',
    "a",
  ],
  ["let x=1;", "x"],
  ["function f(){}", "f"],
  ["class C{}", "C"],
  ['"use strict";var z;', "z"],
  ["(()=>{var a=1})();", null],
  ["(self.webpackChunksolpg=self.webpackChunksolpg||[]).push([[1],{}]);", null],
];

for (const [script, expected] of CASES) {
  test(`topLevelName(${JSON.stringify(script)}) is ${expected}`, () => {
    assert.equal(topLevelName(script), expected);
  });
}
