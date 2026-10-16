// `@types/mocha` also declares a global `it`, without `each`
import { expect, it } from "vitest";

import { atLeast, isLevel, isReported } from "./severity";

it.each([
  ["panic", false, true],
  ["error", true, true],
  ["error", false, false],
  ["warn", true, true],
  ["warn", false, false],
  ["info", true, false],
  ["debug", true, false],
] as const)(
  "should report %s with report=%s: %s",
  (level, requested, reported) => {
    expect(isReported(level, requested)).toBe(reported);
  }
);

it.each([
  ["warn", "warn", true],
  ["error", "warn", true],
  ["info", "warn", false],
] as const)(
  "should treat %s as at least %s: %s",
  (level, threshold, expected) => {
    expect(atLeast(level, threshold)).toBe(expected);
  }
);

it.each([
  ["warn", true],
  ["verbose", false],
  ["toString", false],
])("should recognise %s as a level: %s", (value, expected) => {
  expect(isLevel(value)).toBe(expected);
});
