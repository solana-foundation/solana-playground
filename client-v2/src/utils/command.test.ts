// A command that fails before its handler still finishes: the flow, the
// stepper and the stages wait on `onDidFinish` to leave "running"; and a
// stop (Ctrl+C, the strip's Stop) reaches the run in flight. A file of its
// own rather than an in-source block: `command.ts` is the commands' runtime,
// and the terminal it runs through is stubbed here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unknownCommandTelemetry } from "@/features/unknown-command";

import { PgCommandManager } from "./command";
import { isStopped, StoppedError } from "./stopped";
import { PgTerminal, TerminalLineError } from "./terminal";
import { SLOW_RUN_LINE, SLOW_RUN_MS } from "./terminal/slow-run";

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
  needsConnection,
}: {
  preChecks?: () => void;
  handle: (input: { signal: AbortSignal; lockStop: () => void }) => unknown;
  stoppable?: true;
  needsConnection?: true;
}) => {
  PgCommandManager.all = {
    probe: {
      name: "probe",
      description: "",
      options: [],
      preChecks,
      handle,
      stoppable,
      needsConnection,
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

describe("PgCommandManager.onDidEnd", () => {
  const ends = () => {
    let count = 0;
    const sub = PgCommandManager.onDidEnd("probe", () => count++);
    return { count: () => count, dispose: () => sub.dispose() };
  };

  it("ends a run that only printed its help, which finishes nothing", async () => {
    vi.spyOn(PgTerminal, "println").mockResolvedValue(undefined as never);
    const handle = vi.fn();
    PgCommandManager.all = {
      probe: {
        name: "probe",
        description: "",
        args: [{ name: "amount", optional: true, parse: Number }],
        options: [],
        handle,
      },
    } as never;
    const { seen, dispose: stopFinishes } = finishes();
    const { count, dispose } = ends();

    await PgCommandManager.execute(["probe", "--help"]);

    dispose();
    stopFinishes();
    expect(handle).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(count()).toBe(1);
  });

  it("ends a run once, however it finished", async () => {
    install({
      handle: async () => {
        throw new Error("boom");
      },
    });
    const { count, dispose } = ends();

    await expect(PgCommandManager.execute(["probe"])).rejects.toThrow("boom");
    install({ handle: async () => 1 });
    await PgCommandManager.execute(["probe"]);

    dispose();
    expect(count()).toBe(2);
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
      `^C\n${PgTerminal.warning(
        "This step can't be stopped. Wait for it to finish."
      )}`,
      { noColor: true }
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
      `^C\n${PgTerminal.warning(
        "`probe` can't be stopped. Wait for it to finish."
      )}`,
      { noColor: true }
    );

    finish();
    await expect(run).resolves.toBeUndefined();
    expect(PgCommandManager.stop()).toBe(false);
  });
});

describe("PgCommandManager.execute, an unknown command", () => {
  it("suggests the closest command and offers it to Up", async () => {
    const track = vi.spyOn(unknownCommandTelemetry, "track");
    install({ handle: vi.fn() });
    const offerFromHistory = vi.fn();
    vi.spyOn(PgTerminal, "get").mockResolvedValue({
      offerFromHistory,
    } as never);

    const run = PgCommandManager.execute(["prboe"]);

    await expect(run).rejects.toBeInstanceOf(TerminalLineError);
    await expect(run).rejects.toThrow(
      "`prboe` is not a command. Did you mean `probe`?"
    );
    expect(track).toHaveBeenCalledWith("unknown_command_answered", {
      kind: "suggestion",
    });
    expect(offerFromHistory).toHaveBeenCalledWith("probe");
  });

  it("points to help, offering nothing, when nothing is close", async () => {
    install({ handle: vi.fn() });
    const get = vi.spyOn(PgTerminal, "get");

    await expect(PgCommandManager.execute(["xyzzy"])).rejects.toThrow(
      "`xyzzy` is not a command. Type `help` to see commands."
    );
    expect(get).not.toHaveBeenCalled();
  });
});

describe("PgCommandManager.execute, offline", () => {
  const offline = () =>
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

  it("ends a command that needs a connection with the offline line, before its pre-checks", async () => {
    offline();
    const preChecks = vi.fn();
    const handle = vi.fn();
    install({ preChecks, handle, needsConnection: true });
    const { seen, dispose } = finishes();

    const failure = await PgCommandManager.execute(["probe"]).catch((e) => e);

    dispose();
    expect(failure).toBeInstanceOf(TerminalLineError);
    expect(failure.message).toBe(
      "You're offline. This command needs a connection."
    );
    expect(failure.tone).toBe("error");
    expect(preChecks).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    // Nothing started, so nothing finishes
    expect(seen).toEqual([]);
  });

  it("runs a command that needs a connection while online", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    install({ handle: async () => 1, needsConnection: true });

    await expect(PgCommandManager.execute(["probe"])).resolves.toBe(1);
  });

  it("gives a command that needs a connection its help offline", async () => {
    offline();
    install({ handle: async () => 1, needsConnection: true });

    await expect(PgCommandManager.execute(["probe", "--help"])).resolves.toBe(
      1
    );
    await expect(PgCommandManager.execute(["probe", "-h"])).resolves.toBe(1);
  });

  it("answers an unknown command as one offline", async () => {
    offline();
    install({ handle: vi.fn(), needsConnection: true });

    await expect(PgCommandManager.execute(["xyzzy"])).rejects.toThrow(
      "`xyzzy` is not a command."
    );
  });

  it("runs a local command offline", async () => {
    offline();
    install({ handle: async () => 1 });

    await expect(PgCommandManager.execute(["probe"])).resolves.toBe(1);
  });
});

describe("PgCommandManager.execute, a quiet run", () => {
  let printed: string[];
  const slowLines = () =>
    printed.filter((line) => line.includes(SLOW_RUN_LINE));

  beforeEach(() => {
    vi.useFakeTimers();
    printed = [];
    vi.spyOn(PgTerminal, "println").mockImplementation(async (line) => {
      printed.push(line);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says once, in info blue, that a run quiet for 10 s is taking longer", async () => {
    let finish!: () => void;
    install({ handle: () => new Promise<void>((res) => (finish = res)) });

    const run = PgCommandManager.execute(["probe"]);
    await vi.advanceTimersByTimeAsync(SLOW_RUN_MS * 3);
    finish();
    await run;

    expect(slowLines()).toEqual(["\x1b[1;34m" + SLOW_RUN_LINE + "\x1b[0m"]);
  });

  it("says nothing after a run that ended in time", async () => {
    install({ handle: async () => 1 });

    await PgCommandManager.execute(["probe"]);
    await vi.advanceTimersByTimeAsync(SLOW_RUN_MS * 2);

    expect(slowLines()).toEqual([]);
  });

  it("says nothing after a run that failed", async () => {
    install({
      handle: async () => {
        throw new Error("boom");
      },
    });

    await expect(PgCommandManager.execute(["probe"])).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(SLOW_RUN_MS * 2);

    expect(slowLines()).toEqual([]);
  });

  it("logs a slow line it could not print, and the run goes on", async () => {
    vi.spyOn(PgTerminal, "println").mockRejectedValue(new Error("no xterm"));
    let finish!: () => void;
    install({ handle: () => new Promise<void>((res) => (finish = res)) });

    const run = PgCommandManager.execute(["probe"]);
    await vi.advanceTimersByTimeAsync(SLOW_RUN_MS);
    finish();

    await expect(run).resolves.toBeUndefined();
  });

  it("keeps the outer run's clock through a run it starts", async () => {
    let finish!: () => void;
    PgCommandManager.all = {
      outer: {
        name: "outer",
        description: "",
        options: [],
        handle: async () => {
          await PgCommandManager.execute(["inner"]);
          await new Promise<void>((res) => (finish = res));
        },
      },
      inner: { name: "inner", description: "", options: [], handle: () => {} },
    } as never;

    const run = PgCommandManager.execute(["outer"]);
    await vi.advanceTimersByTimeAsync(SLOW_RUN_MS);
    finish();
    await run;

    expect(slowLines()).toHaveLength(1);
  });
});

// HOO-2806: `run missing.ts` was refused here, before the command could count
// the refusal, and with nothing to choose from the line listed nothing
describe("PgCommandManager.execute, an argument's values", () => {
  const installWith = ({
    values,
    handle,
    suggestOnly,
  }: {
    values: string[];
    handle: (input: { args: Record<string, unknown> }) => unknown;
    suggestOnly?: true;
  }) => {
    PgCommandManager.all = {
      probe: {
        name: "probe",
        description: "",
        args: [{ name: "paths", optional: true, values, suggestOnly }],
        options: [],
        handle,
      },
    } as never;
  };

  it("hands a value the list does not hold to a command that checks it itself", async () => {
    const handle = vi.fn(
      async (input: { args: Record<string, unknown> }) => input.args.paths
    );
    installWith({ values: ["client.ts"], handle, suggestOnly: true });

    await expect(
      PgCommandManager.execute(["probe", "missing.ts"])
    ).resolves.toBe("missing.ts");
  });

  it("refuses it for any other command, naming the values", async () => {
    const handle = vi.fn();
    installWith({ values: ["client.ts"], handle });

    await expect(
      PgCommandManager.execute(["probe", "missing.ts"])
    ).rejects.toThrow(
      "Incorrect argument value given: `missing.ts` (possible values: client.ts)"
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it("says there is nothing to choose from rather than an empty list", async () => {
    installWith({ values: [], handle: vi.fn() });

    await expect(
      PgCommandManager.execute(["probe", "missing.ts"])
    ).rejects.toThrow(
      "Incorrect argument value given: `missing.ts` (there is nothing to choose from)"
    );
  });
});
