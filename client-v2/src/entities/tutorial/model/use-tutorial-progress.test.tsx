import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The registered tutorials, the explorer's workspaces, each started
// tutorial's saved progress, and the explorer's init listeners
const state = vi.hoisted(() => ({
  all: [
    { name: "Hello Anchor", pageCount: 6 },
    { name: "Hello Solana", pageCount: 4 },
    {
      name: "Hello Conversation",
      pageCount: 4,
      definition: {
        steps: [
          { id: "program" },
          { id: "deploy" },
          { id: "client" },
          { id: "name" },
        ],
      },
    },
  ],
  workspaces: undefined as string[] | undefined,
  metadata: new Map<string, { pageNumber: number; completed: boolean }>(),
  // Each started tutorial's `.workspace/tutorial-storage.json`
  storage: new Map<string, Record<string, unknown>>(),
  // What reading any storage file throws, when set
  storageFailure: undefined as Error | undefined,
  // What reading a started tutorial's metadata throws when none is set
  unreadable: new Error("ENOENT: no such file") as Error,
  listeners: new Map<string, Set<() => void>>(),
  // Reads of saved progress that wait to be released, oldest first
  held: [] as Promise<void>[],
}));
const warn = vi.hoisted(() => vi.fn());
const error = vi.hoisted(() => vi.fn());
const on = vi.hoisted(() => (event: string) => (cb: () => void) => {
  const set = state.listeners.get(event) ?? new Set();
  set.add(cb);
  state.listeners.set(event, set);
  return { dispose: () => set.delete(cb) };
});

vi.mock("@/shared/lib/logger", () => ({
  createLogger: () => ({ warn, error, info: vi.fn() }),
}));
vi.mock("../../../utils/tutorial/tutorial", () => ({
  PgTutorial: {
    get all() {
      return state.all;
    },
    isStarted: (name: string) => {
      if (!state.workspaces) throw new Error("Explorer not initialized");
      return state.workspaces.includes(name);
    },
    getMetadata: async (name: string) => {
      const meta = state.metadata.get(name);
      const hold = state.held.shift();
      if (hold) await hold;
      if (!meta) throw state.unreadable;
      return meta;
    },
    getStorageData: async (name: string) => {
      if (state.storageFailure) throw state.storageFailure;
      const data = state.storage.get(name);
      if (!data) throw new Error("ENOENT: no such file");
      return data;
    },
  },
}));
vi.mock("../../../utils/explorer/explorer", () => ({
  PgExplorer: {
    get allWorkspaceNames() {
      return state.workspaces;
    },
    onDidInit: on("init"),
    onDidCreateWorkspace: on("create"),
    onDidDeleteWorkspace: on("delete"),
    onDidChangeWorkspaceList: on("list"),
  },
}));

import { useTutorialProgress } from "./use-tutorial-progress";

const fire = (event: string) =>
  act(() => state.listeners.get(event)?.forEach((cb) => cb()));

describe("useTutorialProgress", () => {
  beforeEach(() => {
    state.workspaces = undefined;
    state.metadata.clear();
    state.storage.clear();
    state.storageFailure = undefined;
    state.listeners.clear();
    state.held = [];
    state.unreadable = new Error("ENOENT: no such file");
    warn.mockClear();
    error.mockClear();
  });

  it("reads every tutorial as new before the explorer knows its workspaces, then reads again once it does", async () => {
    const { result } = renderHook(() => useTutorialProgress());
    expect(result.current("Hello Anchor")).toEqual({ state: "new" });

    state.workspaces = ["Hello Anchor"];
    state.metadata.set("Hello Anchor", { pageNumber: 2, completed: false });
    fire("init");

    await waitFor(() =>
      expect(result.current("Hello Anchor")).toEqual({
        state: "started",
        page: 2,
        pages: 6,
      })
    );
    expect(result.current("Hello Solana")).toEqual({ state: "new" });
  });

  it("counts a conversation tutorial's passed steps", async () => {
    state.workspaces = ["Hello Conversation"];
    state.storage.set("Hello Conversation", {
      conversation: {
        version: 1,
        passed: ["program", "deploy"],
        finishedAt: null,
        startedAt: 1000,
      },
    });
    const { result } = renderHook(() => useTutorialProgress());

    await waitFor(() =>
      expect(result.current("Hello Conversation")).toEqual({
        state: "started",
        page: 2,
        pages: 4,
      })
    );
  });

  it("shows a conversation tutorial done once its finish has shown", async () => {
    state.workspaces = ["Hello Conversation"];
    state.storage.set("Hello Conversation", {
      conversation: {
        version: 1,
        passed: ["program"],
        finishedAt: 1,
        startedAt: 1000,
      },
    });
    const { result } = renderHook(() => useTutorialProgress());

    await waitFor(() =>
      expect(result.current("Hello Conversation")).toEqual({
        state: "completed",
      })
    );
  });

  it("reads a definition tutorial opened but never started as new, silently", async () => {
    state.workspaces = ["Hello Conversation", "Hello Anchor"];
    state.metadata.set("Hello Conversation", {
      pageNumber: 1,
      completed: false,
    });
    state.metadata.set("Hello Anchor", { pageNumber: 2, completed: false });
    const { result } = renderHook(() => useTutorialProgress());

    // Hello Anchor's page shows once the read has landed
    await waitFor(() =>
      expect(result.current("Hello Anchor")).toEqual({
        state: "started",
        page: 2,
        pages: 6,
      })
    );
    expect(result.current("Hello Conversation")).toEqual({ state: "new" });
    expect(error).not.toHaveBeenCalled();
  });

  it("reads a conversation saved before Start, or after Start over, as new", async () => {
    state.workspaces = ["Hello Conversation", "Hello Anchor"];
    state.storage.set("Hello Conversation", {
      conversation: {
        version: 1,
        passed: [],
        finishedAt: null,
        startedAt: null,
      },
    });
    state.metadata.set("Hello Anchor", { pageNumber: 2, completed: false });
    const { result } = renderHook(() => useTutorialProgress());

    await waitFor(() =>
      expect(result.current("Hello Anchor")).toEqual({
        state: "started",
        page: 2,
        pages: 6,
      })
    );
    expect(result.current("Hello Conversation")).toEqual({ state: "new" });
  });

  it("reports a storage file it cannot read, and shows the page", async () => {
    state.workspaces = ["Hello Conversation"];
    state.metadata.set("Hello Conversation", {
      pageNumber: 2,
      completed: false,
    });
    state.storageFailure = new SyntaxError("Unexpected token");
    const { result } = renderHook(() => useTutorialProgress());

    await waitFor(() =>
      expect(result.current("Hello Conversation")).toEqual({
        state: "started",
        page: 2,
        pages: 4,
      })
    );
    expect(error).toHaveBeenCalledWith(state.storageFailure, {
      report: true,
      context: { tutorial: "Hello Conversation" },
    });
  });

  it("warns of a saved conversation it cannot read, and shows the page", async () => {
    state.workspaces = ["Hello Conversation"];
    state.metadata.set("Hello Conversation", {
      pageNumber: 2,
      completed: false,
    });
    state.storage.set("Hello Conversation", {
      conversation: { version: 2, steps: [] },
    });
    const { result } = renderHook(() => useTutorialProgress());

    await waitFor(() =>
      expect(result.current("Hello Conversation")).toEqual({
        state: "started",
        page: 2,
        pages: 4,
      })
    );
    expect(warn).toHaveBeenCalledWith(
      "saved conversation of Hello Conversation is unreadable",
      { context: { tutorial: "Hello Conversation" } }
    );
  });

  it("reads a tutorial it does not know as new", () => {
    state.workspaces = [];
    const { result } = renderHook(() => useTutorialProgress());
    expect(result.current("Nowhere")).toEqual({ state: "new" });
  });

  it("reads again when a workspace arrives without a switch, as sync imports one", async () => {
    state.workspaces = [];
    const { result } = renderHook(() => useTutorialProgress());
    await waitFor(() => expect(state.listeners.get("list")?.size).toBe(1));

    state.workspaces = ["Hello Anchor"];
    state.metadata.set("Hello Anchor", { pageNumber: 3, completed: false });
    fire("list");

    await waitFor(() =>
      expect(result.current("Hello Anchor")).toEqual({
        state: "started",
        page: 3,
        pages: 6,
      })
    );
  });

  it("reports a saved progress it cannot parse, and still shows the tutorial started", async () => {
    state.workspaces = ["Hello Anchor"];
    state.unreadable = new SyntaxError("Unexpected token");
    const { result } = renderHook(() => useTutorialProgress());

    await waitFor(() =>
      expect(result.current("Hello Anchor")).toEqual({
        state: "started",
        page: 1,
        pages: 6,
      })
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toMatchObject({ report: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("shows a started tutorial on page 1 when its progress file is missing, and logs it", async () => {
    state.workspaces = ["Hello Anchor"];
    const { result } = renderHook(() => useTutorialProgress());

    await waitFor(() =>
      expect(result.current("Hello Anchor")).toEqual({
        state: "started",
        page: 1,
        pages: 6,
      })
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
  it("keeps the latest read when an earlier one finishes after it", async () => {
    state.workspaces = ["Hello Anchor"];
    state.metadata.set("Hello Anchor", { pageNumber: 2, completed: false });
    let release = () => {};
    state.held.push(new Promise<void>((r) => (release = r)));
    const { result } = renderHook(() => useTutorialProgress());

    state.metadata.set("Hello Anchor", { pageNumber: 5, completed: false });
    fire("list");
    await waitFor(() =>
      expect(result.current("Hello Anchor")).toMatchObject({ page: 5 })
    );

    await act(async () => release());
    expect(result.current("Hello Anchor")).toMatchObject({ page: 5 });
  });

  it("sets nothing once unmounted with a read in flight", async () => {
    state.workspaces = ["Hello Anchor"];
    state.metadata.set("Hello Anchor", { pageNumber: 2, completed: false });
    let release = () => {};
    state.held.push(new Promise<void>((r) => (release = r)));
    const { unmount } = renderHook(() => useTutorialProgress());
    const consoleError = vi.spyOn(console, "error");

    unmount();
    await act(async () => release());
    expect(consoleError).not.toHaveBeenCalled();
    expect(state.listeners.get("list")?.size ?? 0).toBe(0);
    consoleError.mockRestore();
  });
});
