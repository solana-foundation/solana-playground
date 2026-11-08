import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flush = vi.fn<() => Promise<void>>();
vi.mock("../../utils/explorer/fs", () => ({
  PgFs: { flush: () => flush() },
}));
const report = vi.fn();
vi.mock("../../features/persistence/model/diagnostics", () => ({
  report: (...args: unknown[]) => report(...args),
}));

import { fsFlush } from "./fs-flush";

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("fsFlush", () => {
  let disposable: { dispose: () => void };

  beforeEach(() => {
    flush.mockReset().mockResolvedValue(undefined);
    report.mockReset();
    disposable = fsFlush();
  });

  afterEach(() => {
    disposable.dispose();
    setVisibility("visible");
  });

  it("saves the file tree when the page is hidden", () => {
    setVisibility("hidden");

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("saves the file tree on pagehide", () => {
    window.dispatchEvent(new Event("pagehide"));

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("saves nothing when the page becomes visible", () => {
    setVisibility("visible");

    expect(flush).not.toHaveBeenCalled();
  });

  it("reports a failed save and does not throw", async () => {
    const error = new Error("quota");
    flush.mockRejectedValue(error);

    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));

    expect(report.mock.calls[0][1]).toBe(error);
  });

  it("stops listening once disposed", () => {
    disposable.dispose();

    window.dispatchEvent(new Event("pagehide"));
    setVisibility("hidden");

    expect(flush).not.toHaveBeenCalled();
  });
});
