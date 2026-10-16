// `@types/mocha` also declares a global `it`, without `each`
import { describe, expect, it, vi } from "vitest";

import { consoleProvider, defaultLevel } from "./console";
import type { LogEntry } from "../types";

const entry = (
  fields: Pick<LogEntry, "level"> & Partial<LogEntry>
): LogEntry => ({
  ns: fields.ns ?? "persistence:sync",
  level: fields.level,
  message: fields.message ?? "push rejected",
  error: fields.error,
  context: fields.context,
  report: false,
  unhandled: false,
});

beforeEach(() => {
  for (const method of ["error", "warn", "info", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

it.each([
  ["panic", "error"],
  ["error", "error"],
  ["warn", "warn"],
  ["info", "info"],
  ["debug", "debug"],
] as const)("should print %s with console.%s", (level, method) => {
  consoleProvider({ level: "debug" }).log(entry({ level }));

  expect(console[method]).toHaveBeenCalledWith(
    "[persistence:sync]",
    "push rejected"
  );
});

it("should print only entries at or above its threshold", () => {
  const provider = consoleProvider({ level: "warn" });

  provider.log(entry({ level: "info", message: "hidden" }));
  provider.log(entry({ level: "warn", message: "shown" }));

  expect(console.info).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledWith("[persistence:sync]", "shown");
});

describe("defaultLevel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["production", undefined, "warn"],
    ["development", undefined, "debug"],
    ["production", "info", "info"],
    ["production", "verbose", "warn"],
  ])(
    "should resolve NODE_ENV=%s and REACT_APP_LOG_LEVEL=%s to %s",
    (nodeEnv, configured, expected) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("REACT_APP_LOG_LEVEL", configured);

      expect(defaultLevel()).toBe(expected);
    }
  );
});
