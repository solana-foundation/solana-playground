import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SAMPLE_RATE } from "./sample-rate.mjs";

describe("SAMPLE_RATE", () => {
  for (const [value, isRate] of [
    ["0", true],
    ["1", true],
    [".5", true],
    ["1.0", true],
    ["1.5", false],
    ["-1", false],
    ["0x1", false],
    ["1e-1", false],
  ]) {
    it(`${isRate ? "accepts" : "rejects"} "${value}"`, () => {
      assert.equal(SAMPLE_RATE.test(value), isRate);
    });
  }
});
