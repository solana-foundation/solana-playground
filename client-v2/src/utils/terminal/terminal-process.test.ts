import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  unavailableHere,
  wasFailureShown,
} from "@/shared/lib/report-button-failure";
import { StoppedError } from "../stopped";
import { isTerminalUnmounted, PgTerminal } from "./terminal";

beforeEach(() => {
  PgTerminal.setConsoleOpen(true);
  // The instance prints `Process error: …` and rethrows; the stub keeps the
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
