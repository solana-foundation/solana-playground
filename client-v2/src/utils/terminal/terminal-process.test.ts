import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wasFailureShown } from "@/shared/lib/report-button-failure";
import { PgTerminal } from "./terminal";

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

  it("leaves a success alone", async () => {
    await expect(PgTerminal.process(() => 42)).resolves.toBe(42);
  });
});
