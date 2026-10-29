import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mocha from "mocha/browser-entry";

import { PgJsRuntime } from "./js-runtime";

// The BDD functions mocha 10's `mocha.setup({ ui: "bdd" })` puts on the global
// object
const BDD = [
  "after",
  "afterEach",
  "before",
  "beforeEach",
  "context",
  "describe",
  "it",
  "specify",
  "xcontext",
  "xdescribe",
  "xit",
  "xspecify",
];

// Which of them the fake `setup` defines; a case drops one to see it named
const fake = vi.hoisted(() => ({ defines: [] as string[] }));

vi.mock("mocha/browser-entry", () => ({
  _state: "init",
  suite: { suites: [], tests: [] },
  setup: vi.fn(() => {
    for (const name of fake.defines) {
      Object.assign(globalThis, { [name]: vi.fn() });
    }
  }),
  run: vi.fn(),
}));
vi.mock("../connection", () => ({ PgConnection: { current: {} } }));
vi.mock("../wallet", () => ({ PgWallet: { current: null } }));
vi.mock("../program-info", () => ({ PgProgramInfo: {} }));
vi.mock("../program-interaction", () => ({ PgProgramInteraction: {} }));

/** `_getGlobals` for a test run, as `execute` calls it */
const testGlobals = (): Promise<{
  globals: [string, unknown][];
  endCode: string;
}> =>
  (
    PgJsRuntime as unknown as {
      _getGlobals(params: { isTest: boolean }): Promise<{
        globals: [string, unknown][];
        endCode: string;
      }>;
    }
  )._getGlobals({ isTest: true });

const clearBdd = () => {
  for (const name of BDD) {
    delete (globalThis as Record<string, unknown>)[name];
  }
};

describe("PgJsRuntime test globals", () => {
  beforeEach(() => {
    vi.stubGlobal("PACKAGES", { global: {}, importable: {} });
    fake.defines = BDD;
    clearBdd();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearBdd();
  });

  it("hands test code every function mocha.setup defined, and its run", async () => {
    const { globals, endCode } = await testGlobals();
    const byName = new Map(globals);

    for (const name of BDD) {
      expect(byName.get(name)).toBe(
        (globalThis as Record<string, unknown>)[name]
      );
    }
    expect(byName.get("_run")).toBe(mocha.run);
    expect(endCode).toBe("_run()");
  });

  it("clears the previous run's suites before setting mocha up again", async () => {
    await testGlobals();
    mocha.suite.suites.push("an earlier run's suite");
    mocha.suite.tests.push("an earlier run's test");

    await testGlobals();

    expect(mocha.suite.suites).toEqual([]);
    expect(mocha.suite.tests).toEqual([]);
  });

  it("names a function mocha.setup left undefined", async () => {
    fake.defines = BDD.filter((name) => name !== "xspecify");

    await expect(testGlobals()).rejects.toThrow(
      "mocha.setup did not define `xspecify`"
    );
  });
});
