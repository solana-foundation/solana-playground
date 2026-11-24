import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";

import { PgWallet } from "../../../utils";
import { useDraftKey } from "./useDraftKey";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgWallet: { makeKey: vi.fn(), forgetKey: vi.fn() },
}));

const MADE = "9ohTQmMgo8uYEG8DgZn2bTt1Km6WGnBUa7UNAqC3odC";

let logs: ReturnType<typeof logMemory>;
beforeEach(() => {
  logs = logMemory();
  initLogger({ providers: [logs] });
  vi.mocked(PgWallet.forgetKey).mockResolvedValue();
});
afterEach(() => {
  vi.clearAllMocks();
  resetLogger();
});

describe("components/Wallet/hooks/useDraftKey", () => {
  it("gives the made key, and forgets it when the dialog closes", async () => {
    vi.mocked(PgWallet.makeKey).mockResolvedValue(MADE);
    const { result, unmount } = renderHook(() => useDraftKey());

    await waitFor(() => expect(result.current.publicKey).toBe(MADE));
    expect(result.current.isFailed).toBe(false);
    await expect(result.current.made()).resolves.toBe(MADE);

    unmount();
    await waitFor(() => expect(PgWallet.forgetKey).toHaveBeenCalledWith(MADE));
  });

  it("forgets a key made after the dialog closed, and sets nothing", async () => {
    let resolve: (key: string) => void = () => {};
    vi.mocked(PgWallet.makeKey).mockReturnValue(
      new Promise((res) => (resolve = res))
    );
    let renders = 0;
    const { result, unmount } = renderHook(() => {
      renders += 1;
      return useDraftKey();
    });
    await waitFor(() => expect(PgWallet.makeKey).toHaveBeenCalledOnce());
    const rendered = renders;

    unmount();
    expect(PgWallet.forgetKey).not.toHaveBeenCalled();
    resolve(MADE);

    await waitFor(() => expect(PgWallet.forgetKey).toHaveBeenCalledWith(MADE));
    expect(PgWallet.forgetKey).toHaveBeenCalledOnce();
    expect(renders).toBe(rendered);
    expect(result.current.publicKey).toBeUndefined();
    expect(logs.entries).toEqual([]);
  });

  it("says making the key failed, reported once, and forgets nothing", async () => {
    const failure = new Error("Wallet unavailable");
    vi.mocked(PgWallet.makeKey).mockRejectedValue(failure);
    const { result, unmount } = renderHook(() => useDraftKey());

    await waitFor(() => expect(result.current.isFailed).toBe(true));
    expect(result.current.publicKey).toBeUndefined();
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]).toMatchObject({
      level: "error",
      report: true,
      error: failure,
    });
    await expect(result.current.made()).rejects.toBe(failure);

    unmount();
    await Promise.resolve();
    expect(PgWallet.forgetKey).not.toHaveBeenCalled();
    expect(logs.entries).toHaveLength(1);
  });
});
