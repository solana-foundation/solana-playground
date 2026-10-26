import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The events the hook follows, each with listeners of its own */
type Event = "current" | "init" | "switch" | "create" | "delete" | "list";

// The current tutorial, the workspace list and the events that change them
const state = vi.hoisted(() => ({
  current: null as { name: string } | null,
  workspaces: undefined as string[] | undefined,
  listeners: new Map<string, Set<() => void>>(),
}));
const on = vi.hoisted(() => (event: string) => (cb: () => void) => {
  const set = state.listeners.get(event) ?? new Set();
  set.add(cb);
  state.listeners.set(event, set);
  return { dispose: () => set.delete(cb) };
});
vi.mock("../../../utils/tutorial/tutorial", () => ({
  PgTutorial: {
    get current() {
      return state.current;
    },
    onDidChangeCurrent: on("current"),
  },
}));
vi.mock("../../../utils/explorer/explorer", () => ({
  PgExplorer: {
    get allWorkspaceNames() {
      return state.workspaces;
    },
    onDidInit: on("init"),
    onDidSwitchWorkspace: on("switch"),
    onDidCreateWorkspace: on("create"),
    onDidDeleteWorkspace: on("delete"),
    onDidChangeWorkspaceList: on("list"),
  },
}));

import { useTutorialBeforeStart } from "./use-tutorial-before-start";

const fire = (event: Event) =>
  act(() => state.listeners.get(event)?.forEach((cb) => cb()));

describe("useTutorialBeforeStart", () => {
  beforeEach(() => {
    state.current = { name: "Hello Anchor" };
    state.workspaces = [];
    state.listeners.clear();
  });

  it("names a tutorial on screen that is not started", () => {
    const { result } = renderHook(() => useTutorialBeforeStart());
    expect(result.current).toBe("Hello Anchor");
  });

  it("names it while other projects exist", () => {
    state.workspaces = ["Counter"];
    const { result } = renderHook(() => useTutorialBeforeStart());
    expect(result.current).toBe("Hello Anchor");
  });

  it("is null once the tutorial's workspace exists", () => {
    state.workspaces = ["Hello Anchor"];
    const { result } = renderHook(() => useTutorialBeforeStart());
    expect(result.current).toBeNull();
  });

  it("is null off a tutorial's route", () => {
    state.current = null;
    const { result } = renderHook(() => useTutorialBeforeStart());
    expect(result.current).toBeNull();
  });

  it("is null before the explorer knows its workspaces, and names it once it does", () => {
    state.workspaces = undefined;
    const { result } = renderHook(() => useTutorialBeforeStart());
    expect(result.current).toBeNull();

    state.workspaces = [];
    fire("init");
    expect(result.current).toBe("Hello Anchor");
  });

  it.each([
    ["Start switching to the new workspace", "switch"],
    ["sync importing it without a switch", "create"],
    ["another tab's list arriving", "list"],
  ] as const)("follows %s", (_, event) => {
    const { result } = renderHook(() => useTutorialBeforeStart());
    state.workspaces = ["Hello Anchor"];
    fire(event);
    expect(result.current).toBeNull();
  });

  it("follows the workspace's deletion", () => {
    state.workspaces = ["Hello Anchor"];
    const { result } = renderHook(() => useTutorialBeforeStart());
    state.workspaces = [];
    fire("delete");
    expect(result.current).toBe("Hello Anchor");
  });

  it("follows the route to another tutorial and off it", () => {
    const { result } = renderHook(() => useTutorialBeforeStart());
    state.current = { name: "Counter PDA Tutorial" };
    fire("current");
    expect(result.current).toBe("Counter PDA Tutorial");

    state.current = null;
    fire("current");
    expect(result.current).toBeNull();
  });

  it("stops listening to every event once unmounted", () => {
    const { unmount } = renderHook(() => useTutorialBeforeStart());
    expect(state.listeners.size).toBe(6);
    unmount();
    for (const set of state.listeners.values()) expect(set.size).toBe(0);
  });
});
