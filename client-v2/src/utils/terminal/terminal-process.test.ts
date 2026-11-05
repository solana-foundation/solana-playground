import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  installGlobalHandlers,
  memoryProvider,
  resetLogger,
} from "@/shared/lib/logger";
import {
  unavailableHere,
  wasFailureShown,
} from "@/shared/lib/report-button-failure";

import { StoppedError } from "../stopped";
import { TonedLineError } from "./line-error";
import { PgShell } from "./shell";
import { SLOW_RUN_LINE, SLOW_RUN_MS, watchSlowRun } from "./slow-run";
import { isTerminalUnmounted, PgTerm, PgTerminal } from "./terminal";

beforeEach(() => {
  PgTerminal.setConsoleOpen(true);
  // The instance prints the failure's line and rethrows; the stub keeps the
  // rethrow, which is all the static method sees
  vi.spyOn(PgTerminal, "get").mockResolvedValue({
    process: (cb: () => unknown) => Promise.resolve().then(cb),
  } as never);
});

afterEach(() => {
  PgTerminal.setConsoleOpen(false);
  vi.restoreAllMocks();
});

describe("PgTerminal.process", () => {
  it("marks a failure it rethrows as shown", async () => {
    const failure = new Error("build failed");

    await expect(
      PgTerminal.process(() => {
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(wasFailureShown(failure)).toBe(true);
  });

  it("marks a thrown string", async () => {
    await expect(
      PgTerminal.process(() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal -- the case under test is a thrown string
        throw "AccountNotFound";
      })
    ).rejects.toBe("AccountNotFound");

    expect(wasFailureShown("AccountNotFound")).toBe(true);
  });

  it("does not mark a failure the folded console hid", async () => {
    PgTerminal.setConsoleOpen(false);
    const failure = new Error("send failed");

    await expect(
      PgTerminal.process(() => {
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(wasFailureShown(failure)).toBe(false);
  });

  it("does not mark a failure when there is no terminal to print it", async () => {
    const failure = new Error("no terminal");
    vi.spyOn(PgTerminal, "get").mockRejectedValue(failure);

    await expect(PgTerminal.process(() => 42)).rejects.toBe(failure);

    expect(wasFailureShown(failure)).toBe(false);
  });

  // The person asked for it: the terminal says what stopped, and no button
  // may toast "Could not build" for it, folded console or not
  it("marks a stopped run as shown, even in a folded console", async () => {
    PgTerminal.setConsoleOpen(false);
    const stopped = new StoppedError("Stopped.");

    await expect(
      PgTerminal.process(() => {
        throw stopped;
      })
    ).rejects.toBe(stopped);

    expect(wasFailureShown(stopped)).toBe(true);
  });

  it("leaves a success alone", async () => {
    await expect(PgTerminal.process(() => 42)).resolves.toBe(42);
  });

  // Home mounts no terminal; the call used to wait forever and leave the
  // clicked button spinning
  it("fails when no terminal is mounted", async () => {
    vi.mocked(PgTerminal.get).mockRestore();
    const cb = vi.fn();

    await expect(PgTerminal.process(cb)).rejects.toSatisfy(isTerminalUnmounted);

    expect(cb).not.toHaveBeenCalled();
  });

  // The button's toast names the way out rather than a failure
  it("is unavailable here, with a way out, when no terminal is mounted", async () => {
    vi.mocked(PgTerminal.get).mockRestore();

    const failure = await PgTerminal.process(() => 42).catch((e) => e);

    expect(unavailableHere(failure)).toBe("open a project to use the terminal");
  });
});

describe("PgTerminal.run", () => {
  it("fails when no terminal is mounted", async () => {
    await expect(PgTerminal.run({ clear: [{ full: true }] })).rejects.toSatisfy(
      isTerminalUnmounted
    );
  });
});

// Called without `await` all over the app: a terminal that is not there has
// nothing to print or focus, and must not raise an unhandled rejection
describe.each([
  ["println", () => PgTerminal.println("hello")],
  ["enable", () => PgTerminal.enable()],
  ["focus", () => PgTerminal.focus()],
  ["clear", () => PgTerminal.clear()],
])("PgTerminal.%s", (_, call) => {
  it("does nothing when no terminal is mounted", async () => {
    await expect(call()).resolves.toBeUndefined();
  });

  it("still fails on any other error", async () => {
    const failure = new Error("xterm threw");
    vi.spyOn(PgTerminal, "run").mockRejectedValue(failure);

    await expect(call()).rejects.toBe(failure);
  });
});

describe("PgTerm.process, a line with a tone", () => {
  const fakeTerm = (previousLine: string | undefined) => ({
    disable: vi.fn(),
    enable: vi.fn(),
    scrollToBottom: vi.fn(),
    println: vi.fn(),
    _tty: {
      getLine: () =>
        previousLine ? { translateToString: () => previousLine } : undefined,
    },
  });

  const failWith = (term: ReturnType<typeof fakeTerm>, failure: Error) =>
    PgTerm.prototype.process.call(term as never, () => {
      throw failure;
    });

  it("prints it in the terminal's own colour for that tone", async () => {
    const term = fakeTerm(undefined);
    const failure = new TonedLineError("error", "Offline.");

    await expect(failWith(term, failure)).rejects.toBe(failure);

    expect(term.println).toHaveBeenCalledWith(PgTerminal.error("Offline."));
  });

  it("does not repeat a line already on screen, whatever its colour", async () => {
    const term = fakeTerm("Offline.");
    const failure = new TonedLineError("error", "Offline.");

    await expect(failWith(term, failure)).rejects.toBe(failure);

    expect(term.println).not.toHaveBeenCalled();
  });
});

// The slow-run clock's own tests call its functions by hand; these are the
// terminal calling them
describe("the terminal feeding the slow-run clock", () => {
  let printed: string[];
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    printed = [];
    stop = watchSlowRun((line) => printed.push(line));
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("starts the 10 s again when the terminal prints", () => {
    const term = {
      _isOpen: true,
      _shell: { isPrompting: () => false },
      _tty: { print: vi.fn() },
    };

    vi.advanceTimersByTime(SLOW_RUN_MS - 1);
    PgTerm.prototype.print.call(term as never, "output");
    vi.advanceTimersByTime(SLOW_RUN_MS - 1);
    expect(printed).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(printed).toEqual([SLOW_RUN_LINE]);
  });

  it("does not count the time a question stays open", async () => {
    const shell = {
      _waitingForInput: false,
      _prefixes: { waitingInputMsg: "" },
      _prompt: async () => {},
      _tty: { clearLine: vi.fn(), println: vi.fn(), input: "y" },
    };

    const answer = PgShell.prototype.waitForInput.call(shell as never, "Sure?");
    await vi.advanceTimersByTimeAsync(SLOW_RUN_MS * 3);
    expect(printed).toEqual([]);

    document.dispatchEvent(
      new Event(
        (
          PgShell as unknown as { _TERMINAL_WAIT_FOR_INPUT: string }
        )._TERMINAL_WAIT_FOR_INPUT
      )
    );
    await expect(answer).resolves.toBe("y");

    await vi.advanceTimersByTimeAsync(SLOW_RUN_MS);
    expect(printed).toEqual([SLOW_RUN_LINE]);
  });
});

describe("PgTerm.process", () => {
  afterEach(() => resetLogger());

  /** The parts of a terminal `process` touches, without an xterm */
  const fakeTerm = () =>
    Object.assign(Object.create(PgTerm.prototype), {
      disable: () => {},
      enable: () => {},
      scrollToBottom: () => {},
      println: vi.fn(),
      _tty: { getLine: () => undefined },
    }) as PgTerm;

  /** Runs a command that throws `failure` and leaves its rejection unhandled */
  const runFailing = async (failure: Error) => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    const uninstall = installGlobalHandlers();
    const term = fakeTerm();

    const reason = await term
      .process(() => {
        throw failure;
      })
      .catch((error: unknown) => error);
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: reason });
    globalThis.dispatchEvent(event);
    uninstall();

    return { reason, term, logged };
  };

  it("leaves a warning, never a panic, for a command failure the terminal printed", async () => {
    const failure = new Error("Command `nope` not found.");

    const { reason, term, logged } = await runFailing(failure);

    expect(reason).toBe(failure);
    expect(term.println).toHaveBeenCalledWith(
      "Process error: Command `nope` not found."
    );
    expect(logged.entries.map((entry) => entry.level)).toEqual(["warn"]);
    expect(logged.entries[0].report).toBe(false);
  });

  it("still reports a fault in a command, though the terminal printed it", async () => {
    const failure = new TypeError(
      "Cannot read properties of undefined (reading 'deploy')"
    );

    const { logged } = await runFailing(failure);

    expect(logged.entries.map((entry) => entry.level)).toEqual(["panic"]);
    expect(logged.entries[0].report).toBe(true);
  });
});
