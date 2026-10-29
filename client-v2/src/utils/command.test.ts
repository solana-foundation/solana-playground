// A command that fails before its handler still finishes: the flow, the
// stepper and the stages wait on `onDidFinish` to leave "running"; and a
// stop (Ctrl+C, the strip's Stop) reaches the run in flight. A file of its
// own rather than an in-source block: `command.ts` is the commands' runtime,
// and the terminal it runs through is stubbed here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgCommandManager } from "./command";
import { isStopped, StoppedError } from "./stopped";
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
  stoppable,
}: {
  preChecks?: () => void;
  handle: (input: { signal: AbortSignal; lockStop: () => void }) => unknown;
  stoppable?: true;
}) => {
  PgCommandManager.all = {
    probe: {
      name: "probe",
      description: "",
      options: [],
      preChecks,
      handle,
      stoppable,
    },
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

describe("PgCommandManager.stop", () => {
  /** A handler that waits until its run is stopped, then throws as build does */
  const untilStopped = ({ signal }: { signal: AbortSignal }) =>
    new Promise((_, rej) =>
      signal.addEventListener("abort", () => rej(new StoppedError("Stopped.")))
    );

  it("does nothing when no command runs", () => {
    const println = vi.spyOn(PgTerminal, "println").mockResolvedValue();

    expect(PgCommandManager.stop()).toBe(false);
    expect(println).not.toHaveBeenCalled();
  });

  it("aborts a stoppable run, which finishes with the stop", async () => {
    const println = vi.spyOn(PgTerminal, "println").mockResolvedValue();
    install({ handle: untilStopped, stoppable: true });
    const { seen, dispose } = finishes();

    const run = PgCommandManager.execute(["probe"]);
    await Promise.resolve();
    expect(PgCommandManager.stop()).toBe(true);

    const err = await run.catch((e: unknown) => e);
    dispose();
    expect(isStopped(err)).toBe(true);
    expect(println).toHaveBeenCalledWith("^C");
    expect(seen).toEqual([{ err }]);
  });

  it("says nothing more when a run already stopping is stopped again", async () => {
    const println = vi.spyOn(PgTerminal, "println").mockResolvedValue();
    let release = () => {};
    install({
      // Ends a moment after the stop, as a deploy draining its chunks does
      handle: ({ signal }) =>
        new Promise((_, rej) => {
          release = () => rej(new StoppedError("Stopped."));
          signal.addEventListener("abort", () => {});
        }),
      stoppable: true,
    });

    const run = PgCommandManager.execute(["probe"]);
    await Promise.resolve();
    expect(PgCommandManager.stop()).toBe(true);
    expect(PgCommandManager.stop()).toBe(true);

    expect(println.mock.calls).toEqual([["^C"]]);
    release();
    await run.catch(() => {});
  });

  it("stops a stoppable command still in its pre-checks", async () => {
    vi.spyOn(PgTerminal, "println").mockResolvedValue();
    let pass = () => {};
    const handle = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      if (signal.aborted) throw new StoppedError("Stopped.");
    });
    install({
      preChecks: () => new Promise<void>((res) => (pass = res)) as never,
      handle,
      stoppable: true,
    });

    const run = PgCommandManager.execute(["probe"]);
    await Promise.resolve();
    expect(PgCommandManager.stop()).toBe(true);
    pass();

    expect(isStopped(await run.catch((e: unknown) => e))).toBe(true);
  });

  it("says a step that cannot stop goes on", async () => {
    const println = vi.spyOn(PgTerminal, "println").mockResolvedValue();
    let finish = () => {};
    install({
      handle: ({ lockStop }) => {
        lockStop();
        return new Promise<void>((res) => (finish = res));
      },
      stoppable: true,
    });

    const run = PgCommandManager.execute(["probe"]);
    await Promise.resolve();
    expect(PgCommandManager.stop()).toBe(false);
    expect(println).toHaveBeenCalledWith(
      "^C\nThis step can't be stopped. Wait for it to finish."
    );

    finish();
    await expect(run).resolves.toBeUndefined();
  });

  it("says a run that cannot stop goes on", async () => {
    const println = vi.spyOn(PgTerminal, "println").mockResolvedValue();
    let finish = () => {};
    install({
      handle: () => new Promise<void>((res) => (finish = res)),
    });

    const run = PgCommandManager.execute(["probe"]);
    await Promise.resolve();
    expect(PgCommandManager.stop()).toBe(false);
    expect(println).toHaveBeenCalledWith(
      "^C\n`probe` can't be stopped. Wait for it to finish."
    );

    finish();
    await expect(run).resolves.toBeUndefined();
    expect(PgCommandManager.stop()).toBe(false);
  });
});
