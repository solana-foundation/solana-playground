import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

// The route decides the open tutorial; the test stands in for it
const route = vi.hoisted(() => ({
  current: null as { name: string; definition?: object } | null,
  started: true,
  explorerReady: true,
  listeners: new Set<() => void>(),
}));
vi.mock("@/utils/tutorial", () => ({
  PgTutorial: {
    get current() {
      return route.current;
    },
    onDidChangeCurrent: (cb: () => void) => {
      route.listeners.add(cb);
      return { dispose: () => route.listeners.delete(cb) };
    },
    onDidChange: (cb: () => void) => {
      route.listeners.add(cb);
      return { dispose: () => route.listeners.delete(cb) };
    },
    isStarted: () => {
      if (!route.explorerReady) throw new Error("Explorer not initialized");
      return route.started;
    },
  },
}));
vi.mock("@/utils/explorer", () => ({
  PgExplorer: {
    // `isStarted` reads the workspace names, which exist only once it has
    // initialised
    get allWorkspaceNames() {
      if (!route.explorerReady) return null;
      return route.started && route.current ? [route.current.name] : [];
    },
    onDidInit: (cb: () => void) => {
      route.listeners.add(cb);
      return { dispose: () => route.listeners.delete(cb) };
    },
  },
}));
vi.mock("@/hooks", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    useRenderOnChange: (on: (cb: () => void) => { dispose: () => void }) => {
      const [, render] = useReducer((n: number) => n + 1, 0);
      useEffect(() => on(render).dispose, [on]);
    },
  };
});

import { useTutorialFrame } from "./use-tutorial-frame";

const go = (tutorial: typeof route.current) =>
  act(() => {
    route.current = tutorial;
    route.listeners.forEach((cb) => cb());
  });

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  route.current = null;
  route.started = true;
  route.explorerReady = true;
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  resetTelemetry();
});

const draw = () =>
  renderHook(() => useTutorialFrame({ onBack: vi.fn(), body: null }));

const events = (name: string) =>
  sent.events.filter((e) => e.name === name).map((e) => e.params);

describe("useTutorialFrame", () => {
  it("gives no frame outside a tutorial with a definition", () => {
    const { result } = draw();
    expect(result.current.frame).toBeUndefined();
    go({ name: "Counter PDA Tutorial" });
    expect(result.current.frame).toBeUndefined();
  });

  it("keeps the About page's layout until the tutorial is started", () => {
    const { result } = draw();
    route.started = false;
    go({ name: "Hello Anchor", definition: {} });
    expect(result.current.frame).toBeUndefined();
    route.started = true;
    go({ name: "Hello Anchor", definition: {} });
    expect(result.current.frame).toBeDefined();
  });

  it("waits for the explorer before it asks whether the tutorial is started", () => {
    const { result } = draw();
    route.explorerReady = false;
    go({ name: "Hello Anchor", definition: {} });
    expect(result.current.frame).toBeUndefined();
    route.explorerReady = true;
    go({ name: "Hello Anchor", definition: {} });
    expect(result.current.frame).toBeDefined();
  });

  it("folds the navigation on entry and opens it over the chat", () => {
    const { result } = draw();
    go({ name: "Hello Anchor", definition: {} });
    expect(result.current.frame?.nav.fold).toBe("rail");
    expect(result.current.pin).toBeUndefined();

    act(() => result.current.frame?.nav.onOpenChange(true));
    expect(result.current.frame?.nav.fold).toBe("overlay");
    expect(result.current.pin).toBeDefined();
    expect(events("tutorial_frame_menu_opened")).toHaveLength(1);

    act(() => result.current.frame?.nav.onClose());
    expect(result.current.frame?.nav.fold).toBe("rail");
  });

  it("names ⌘B as the menu's opener when a key came last", () => {
    const { result } = draw();
    go({ name: "Hello Anchor", definition: {} });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "b", metaKey: true })
      );
      result.current.frame?.nav.onOpenChange(true);
    });
    expect(events("tutorial_frame_menu_opened")).toEqual([{ via: "key" }]);
  });

  it("names the button when Enter pressed the rail's opener", () => {
    const { result } = draw();
    go({ name: "Hello Anchor", definition: {} });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      result.current.frame?.nav.onOpenChange(true);
    });
    expect(events("tutorial_frame_menu_opened")).toEqual([{ via: "button" }]);
  });

  it("stays pinned when the pin's click also reads as a pick that closes", () => {
    const { result } = draw();
    go({ name: "Hello Anchor", definition: {} });
    act(() => result.current.frame?.nav.onOpenChange(true));
    // The shell closes on the bubble phase, after the pin's own click
    act(() => {
      const pin = result.current.pin as {
        props: { onPinnedChange: (p: boolean) => void };
      };
      pin.props.onPinnedChange(true);
      result.current.frame?.nav.onClose();
    });
    expect(result.current.frame?.nav.fold).toBe("pinned");
    expect(events("tutorial_frame_menu_pinned")).toEqual([{ pinned: true }]);
  });

  it("drops the frame on leaving, and folds again on the next entry", () => {
    const { result } = draw();
    go({ name: "Hello Anchor", definition: {} });
    act(() => result.current.frame?.nav.onOpenChange(true));
    go(null);
    expect(result.current.frame).toBeUndefined();
    go({ name: "Hello Anchor", definition: {} });
    expect(result.current.frame?.nav.fold).toBe("rail");
  });
});
