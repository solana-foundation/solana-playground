// A command that fails before its handler still finishes: the flow, the
// stepper and the stages wait on `onDidFinish` to leave "running". A file of
// its own rather than an in-source block: `command.ts` is the commands'
// runtime, and the terminal it runs through is stubbed here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgCommandManager } from "./command";
import { PgTerminal } from "./terminal";

let saved: typeof PgCommandManager.all;

beforeEach(() => {
  saved = PgCommandManager.all;
  // The terminal prints and rethrows; only the rethrow matters here
  vi.spyOn(PgTerminal, "process").mockImplementation(async (cb) => cb());
});

afterEach(() => {
  PgCommandManager.all = saved;
  vi.restoreAllMocks();
});

/** One command named `probe`, with every field named */
const install = ({
  preChecks,
  handle,
}: {
  preChecks?: () => void;
  handle: () => unknown;
}) => {
  PgCommandManager.all = {
    probe: { name: "probe", description: "", options: [], preChecks, handle },
  } as never;
};

const finishes = () => {
  const seen: unknown[] = [];
  const sub = PgCommandManager.onDidFinish("probe", (r) => seen.push(r));
  return { seen, dispose: () => sub.dispose() };
};

describe("PgCommandManager.execute", () => {
  it("finishes with the error when a pre-check throws", async () => {
    const failure = new Error("Wallet must be connected.");
    const handle = vi.fn();
    install({
      preChecks: () => {
        throw failure;
      },
      handle,
    });
    const { seen, dispose } = finishes();

    await expect(PgCommandManager.execute(["probe"])).rejects.toBe(failure);

    dispose();
    expect(handle).not.toHaveBeenCalled();
    expect(seen).toEqual([{ err: failure }]);
  });

  it("finishes once with the handler's result", async () => {
    install({ handle: async () => 42 });
    const { seen, dispose } = finishes();

    await expect(PgCommandManager.execute(["probe"])).resolves.toBe(42);

    dispose();
    expect(seen).toEqual([{ ok: 42 }]);
  });

  it("finishes once with the handler's error", async () => {
    const failure = new Error("boom");
    install({
      handle: async () => {
        throw failure;
      },
    });
    const { seen, dispose } = finishes();

    await expect(PgCommandManager.execute(["probe"])).rejects.toBe(failure);

    dispose();
    expect(seen).toEqual([{ err: failure }]);
  });
});
