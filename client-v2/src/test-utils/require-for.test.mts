// A test file of its own, not an in-source block in `require-for.ts`: `e2e/` imports that module, and Playwright compiles it as CommonJS, where the block's `import.meta` is a syntax error.

import { requireFor } from "./require-for";

describe("requireFor", () => {
  it("returns a value that is there", () => {
    const box = { x: 1 };
    expect(requireFor("the box")(box)).toBe(box);
  });

  it("keeps falsy values that are there", () => {
    expect(requireFor("zero")(0)).toBe(0);
    expect(requireFor("the empty string")("")).toBe("");
    expect(requireFor("false")(false)).toBe(false);
  });

  it.each([
    // eslint-disable-next-line unicorn/no-null -- Playwright's boundingBox() and the DOM return null, which is what this guards
    ["null", null],
    ["undefined", undefined],
  ])("throws naming what was missing when the value is %s", (_, value) => {
    expect(() => requireFor("the panel's bounding box")(value)).toThrow(
      `Expected the panel's bounding box, got ${String(value)}`
    );
  });
});
