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

// Which of them the fake `setup` defines (a case drops one to see it named),
// and how many suites and tests it found when called
const fake = vi.hoisted(() => ({
  defines: [] as string[],
  atSetup: [] as { suites: number; tests: number }[],
}));

vi.mock("mocha/browser-entry", () => {
  const suite = { suites: [] as unknown[], tests: [] as unknown[] };
  return {
    _state: "init",
    suite,
    setup: vi.fn(() => {
      fake.atSetup.push({
        suites: suite.suites.length,
        tests: suite.tests.length,
      });
      for (const name of fake.defines) {
        Object.assign(globalThis, { [name]: vi.fn() });
      }
    }),
    run: vi.fn(),
  };
});
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

// vitest's own `describe`, `it` and hooks share these names on the global
// object (`globals: true`); each case starts without them, as a first run in
// the browser does, and gives them back after
let saved: Map<string, PropertyDescriptor | undefined>;
const clearBdd = () => {
  for (const name of BDD) {
    delete (globalThis as Record<string, unknown>)[name];
  }
};

describe("PgJsRuntime test globals", () => {
  beforeEach(() => {
    saved = new Map(
      BDD.map((name) => [
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
      ])
    );
    clearBdd();
    vi.stubGlobal("PACKAGES", { global: {}, importable: {} });
    fake.defines = BDD;
    fake.atSetup = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearBdd();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    }
    mocha.suite.suites.length = 0;
    mocha.suite.tests.length = 0;
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
    // `execute` polls `_state` back to "init", which mocha only does when it
    // does not dispose itself after `run`
    expect(mocha.setup).toHaveBeenCalledWith(
      expect.objectContaining({ ui: "bdd", cleanReferencesAfterRun: false })
    );
  });

  it("clears the previous run's suites before setting mocha up again", async () => {
    await testGlobals();
    mocha.suite.suites.push("an earlier run's suite");
    mocha.suite.tests.push("an earlier run's test");

    await testGlobals();

    expect(fake.atSetup).toEqual([
      { suites: 0, tests: 0 },
      { suites: 0, tests: 0 },
    ]);
  });

  it("names a function mocha.setup left undefined", async () => {
    fake.defines = BDD.filter((name) => name !== "xspecify");

    await expect(testGlobals()).rejects.toThrow(
      "mocha.setup did not define `xspecify`"
    );
  });
});
