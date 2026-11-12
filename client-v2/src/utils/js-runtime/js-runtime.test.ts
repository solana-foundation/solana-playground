import { afterEach, describe, expect, it, vi } from "vitest";

import { isRunBusy, RunBusyError } from "./busy";
import { PgJsRuntime } from "./js-runtime";

// A refusal comes before the run touches any of these; their modules reach
// the wasm packages, which do not load under vitest
vi.mock("../common", () => ({ PgCommon: {} }));
vi.mock("../connection", () => ({ PgConnection: {} }));
vi.mock("../program-info", () => ({ PgProgramInfo: {} }));
vi.mock("../terminal", () => ({ PgTerminal: {} }));
vi.mock("../wallet", () => ({ PgWallet: {} }));
vi.mock("../wallet/sign-bridge", () => ({ signRequestWith: vi.fn() }));

describe("PgJsRuntime busy refusal", () => {
  const runtime = PgJsRuntime as unknown as {
    _running: "client" | "tests" | undefined;
  };
  const run = (isTest: boolean) =>
    PgJsRuntime.execute({ fileName: "a.ts", code: "", isTest });

  afterEach(() => {
    runtime._running = undefined;
  });

  it.each([
    ["a client script", false, "client", "Client is already running!"],
    ["tests", true, "client", "Please wait for client to finish."],
    ["a client script", false, "tests", "Please wait for tests to finish."],
    ["tests", true, "tests", "Tests are already running!"],
  ] as const)(
    "refuses %s with a RunBusyError while the %s run",
    // eslint-disable-next-line max-params -- it.each passes one parameter per cell of the row
    async (_, isTest, running, message) => {
      runtime._running = running;
      const refused = run(isTest);
      await expect(refused).rejects.toBeInstanceOf(RunBusyError);
      await expect(refused).rejects.toThrow(message);
      await expect(refused).rejects.toSatisfy(isRunBusy);
    }
  );
});
