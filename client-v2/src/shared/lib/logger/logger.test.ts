// `@types/mocha` also declares a global `it`, without `each`
import { describe, expect, it, vi } from "vitest";

import { createLogger, initLogger, Logger, resetLogger } from "./logger";
import { memoryProvider } from "./providers/memory";

// Created at import, before any `initLogger` in this file runs
const early = createLogger("persistence:sync");

let logged: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  logged = memoryProvider();
  initLogger({ providers: [logged] });
});

afterEach(() => resetLogger());

describe("namespace", () => {
  it.each([
    ["the default", () => Logger.warn("clipboard unavailable"), "app:common"],
    [
      "a per-call option",
      () => Logger.error(new Error("x"), { ns: "wallet:connect" }),
      "wallet:connect",
    ],
    [
      "a bound logger",
      () => createLogger("auth:popup").error(new Error("x")),
      "auth:popup",
    ],
    [
      "a per-call option over a bound logger",
      () => createLogger("auth:popup").warn("x", { ns: "auth:session" }),
      "auth:session",
    ],
  ])("should record %s", (_, act, ns) => {
    act();

    expect(logged.entries.map((entry) => entry.ns)).toEqual([ns]);
  });
});

it("should send entries from a logger created before initLogger to the later providers", () => {
  early.error(new Error("push rejected"));

  expect(logged.entries).toHaveLength(1);
});

it("should keep a thrown non-Error value as the cause", () => {
  Logger.error("timeout");

  const { error } = logged.entries[0];
  expect(error).toBeInstanceOf(Error);
  expect(error?.message).toBe("timeout");
  expect(error?.cause).toBe("timeout");
});

// The rule itself is tested in `severity.test.ts`; this proves the logger applies it
it("should mark an entry reported by its level's rule, not only by the option", () => {
  Logger.panic(new Error("x"));

  expect(logged.entries[0].report).toBe(true);
});

it("should keep delivering to other providers when one throws", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const broken = {
    log: () => {
      throw new Error("broken");
    },
  };
  initLogger({ providers: [broken, logged] });

  Logger.warn("still delivered");

  expect(logged.entries).toHaveLength(1);
  expect(console.error).toHaveBeenCalledWith(
    "[logger:provider] a log provider threw",
    expect.any(Error)
  );
});
