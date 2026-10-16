import assert from "node:assert/strict";
import { test } from "node:test";

import { findColors, isAllowed } from "./check-colors.mjs";

test("finds hex, rgb() and rgba()", () => {
  const text = [
    'const a = "#9945ff";',
    "background: rgb(0 0 0 / 25%);",
    "color: rgba(1, 2, 3, 0.5);",
    "fine: var(--primary);",
  ].join("\n");

  assert.deepEqual(findColors(text), [
    { line: 1, match: "#9945ff" },
    { line: 2, match: "rgb(" },
    { line: 3, match: "rgba(" },
  ]);
});

test("finds the other colour functions", () => {
  const text = [
    "a: hsl(0 0% 100%);",
    "b: hsla(0, 0%, 0%, 0.5);",
    "c: oklch(0.7 0.1 200);",
    "d: color(srgb 1 0 0);",
    "e: hwb(0 0% 0%); lab(50% 0 0); lch(50% 0 0); oklab(0.5 0 0);",
    "fine: resolveColor(x); colorMix(a);",
  ].join("\n");

  assert.deepEqual(
    findColors(text).map((hit) => hit.match),
    ["hsl(", "hsla(", "oklch(", "color(srgb", "hwb(", "lab(", "lch(", "oklab("]
  );
});

test("ignores HTML entities", () => {
  assert.deepEqual(findColors("<>&#8592;&#10003;</>"), []);
});

test("allows only the token bridge and the language logos", () => {
  assert.equal(isAllowed("app/styles/playground-tokens.css"), true);
  assert.equal(isAllowed("app/styles/playground-theme.css"), true);
  assert.equal(isAllowed("shared/lib/css-color/css-color.ts"), true);
  assert.equal(isAllowed("shared/lib/css-color/css-color.test.ts"), true);
  assert.equal(isAllowed("languages/python.tsx"), true);
  assert.equal(isAllowed("components/Markdown/Markdown.tsx"), false);
  assert.equal(isAllowed("views/sidebar/icons/build.svg"), false);
  assert.equal(isAllowed("app/styles/other.css"), false);
});
