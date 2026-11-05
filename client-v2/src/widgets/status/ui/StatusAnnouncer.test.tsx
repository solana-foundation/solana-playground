// The live region on the live sources: silent at first, once per change, and
// again after a recovery.
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StatusIndicator } from "../model/indicators";
import { StatusAnnouncer } from "./StatusAnnouncer";

const live = vi.hoisted(() => ({
  indicators: [] as StatusIndicator[],
  network: { name: "devnet", isConnected: true, slotStalled: false },
  online: true,
}));

vi.mock("../model/use-status", () => ({
  useStatus: () => live.indicators,
  useNetworkInput: () => live.network,
}));
vi.mock("@/shared/lib/hooks/use-online", () => ({
  useOnline: () => live.online,
}));

const rust = (state: StatusIndicator["state"], words: string) =>
  [{ id: "rust", state, words, label: `Rust analyzer, ${words}` }] as never;

describe("StatusAnnouncer", () => {
  const step = (
    rerender: (ui: React.ReactElement) => void,
    next: StatusIndicator[]
  ) => {
    live.indicators = next;
    act(() => rerender(<StatusAnnouncer stage="write" />));
  };

  it("says a failure once, stays quiet at first, and says it again after a recovery", () => {
    live.indicators = rust("working", "starting");
    const { rerender } = render(<StatusAnnouncer stage="write" />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");

    step(rerender, rust("failed", "failed"));
    expect(region.textContent).toBe("Rust analyzer, failed");

    step(rerender, rust("ready", "ready"));
    expect(region.textContent).toBe("");

    step(rerender, rust("failed", "failed"));
    expect(region.textContent).toBe("Rust analyzer, failed");
  });

  it("says nothing for what is down when the page loads", () => {
    live.indicators = rust("failed", "failed");
    render(<StatusAnnouncer stage="write" />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("leaves the network to the notice on Deploy and Interact only", () => {
    const up = [
      { id: "network", state: "ready", words: "Devnet", label: "up" },
    ] as never;
    const down = [
      {
        id: "network",
        state: "not-ready",
        words: "Devnet · Not responding",
        label: "Change cluster",
        announced: "Devnet, not responding",
      },
    ] as never;
    const says = (stage: "write" | "deploy" | "interact" | undefined) => {
      live.network = { name: "devnet", isConnected: true, slotStalled: false };
      live.indicators = up;
      const { rerender, unmount } = render(<StatusAnnouncer stage={stage} />);
      live.network = { name: "devnet", isConnected: false, slotStalled: false };
      live.indicators = down;
      act(() => rerender(<StatusAnnouncer stage={stage} />));
      const text = screen.getByRole("status").textContent;
      unmount();
      live.network = { name: "devnet", isConnected: true, slotStalled: false };
      return text;
    };
    expect(says("deploy")).toBe("");
    expect(says("interact")).toBe("");
    expect(says("write")).toBe("Devnet, not responding");
    expect(says(undefined)).toBe("Devnet, not responding");
  });

  it("speaks where no stage shows the notice, as on Home", () => {
    live.online = false;
    live.indicators = rust("ready", "ready");
    const { rerender } = render(<StatusAnnouncer stage={undefined} />);
    live.indicators = rust("not-ready", "offline");
    act(() => rerender(<StatusAnnouncer stage={undefined} />));
    expect(screen.getByRole("status").textContent).toBe(
      "Rust analyzer, offline"
    );
    live.indicators = rust("ready", "ready");
    act(() => rerender(<StatusAnnouncer stage="write" />));
    live.indicators = rust("not-ready", "offline");
    act(() => rerender(<StatusAnnouncer stage="write" />));
    expect(screen.getByRole("status").textContent).toBe("");
    live.online = true;
  });
});
