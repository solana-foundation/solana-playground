import { render, screen, waitFor } from "@testing-library/react";

import Reader from "./Reader";
import type { LessonStep } from "./types";

const { error } = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/shared/lib/logger", () => ({
  createLogger: () => ({
    panic: vi.fn(),
    error,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../utils", () => ({}));
vi.mock("../../../components/Markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("../../../components/Loading", () => ({ SpinnerWithBg: () => null }));

const step = (readPage: () => Promise<string>): LessonStep => ({
  id: "s1",
  objective: "Say hello on chain",
  verifiedBy: "The build passes.",
  verify: { kind: "build-passes" },
  readPage,
  hints: ["q", "l", "p"],
});

describe("Reader", () => {
  it("renders the loaded page and reports it opened once", async () => {
    const onLoaded = vi.fn();
    render(
      <Reader
        step={step(() => Promise.resolve("Hello from the page"))}
        onLoaded={onLoaded}
        onClose={() => {}}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("Hello from the page")).toBeTruthy()
    );
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("reports a store failure on opening as such, not as a missing page", async () => {
    const onLoaded = vi.fn(() => {
      throw new Error("store broke");
    });
    render(
      <Reader
        step={step(() => Promise.resolve("Hello from the page"))}
        onLoaded={onLoaded}
        onClose={() => {}}
      />
    );
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error.mock.calls[0][0]).toMatchObject({ message: "store broke" });
    expect(error.mock.calls[0][1]).toEqual({ report: true });
    expect(screen.getByText("Hello from the page")).toBeTruthy();
    expect(screen.queryByText(/This page could not be loaded\./)).toBeNull();
  });

  it("logs a page that fails to load and never reports it as opened", async () => {
    const onLoaded = vi.fn();
    render(
      <Reader
        step={step(() => Promise.reject(new Error("gone")))}
        onLoaded={onLoaded}
        onClose={() => {}}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/This page could not be loaded\./)).toBeTruthy()
    );
    expect(onLoaded).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    // Pages are bundled, so a rejection is a broken chunk the team must hear of
    expect(error.mock.calls[0][1]).toEqual({ report: true });
  });
});
