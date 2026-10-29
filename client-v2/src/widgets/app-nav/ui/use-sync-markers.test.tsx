import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSyncMarkers } from "./use-sync-markers";

type Marker = "this-browser" | "not-synced" | null;

/** A subscription the hook takes, which a test fires by hand */
const channel = vi.hoisted(() => () => {
  const listeners = new Set<() => void>();
  return {
    on: (cb: () => void) => {
      listeners.add(cb);
      return { dispose: () => listeners.delete(cb) };
    },
    fire: () => listeners.forEach((cb) => cb()),
  };
});

const state = vi.hoisted(() => ({
  names: [] as string[],
  markerOf: (async () => null) as (id: string, name: string) => Promise<Marker>,
}));
const sources = vi.hoisted(() => ({
  sync: { fire: () => {} },
  session: { fire: () => {} },
  explorer: {} as Record<string, { fire: () => void }>,
}));

vi.mock("@/features/persistence", () => {
  const changes = channel();
  sources.sync = changes;
  return {
    syncMarkerOf: (id: string, name: string) => state.markerOf(id, name),
    onDidChangeSyncMarkers: changes.on,
  };
});
vi.mock("@/features/auth", () => {
  const session = channel();
  sources.session = session;
  return { PgSession: { onDidChange: session.on } };
});
vi.mock("@/utils", () => {
  const event = (name: string) => {
    const c = channel();
    sources.explorer[name] = c;
    return c.on;
  };
  return {
    PgExplorer: {
      get allWorkspaceNames() {
        return state.names;
      },
      workspaceIdOf: (name: string) => `id-${name}`,
      onDidCreateWorkspace: event("create"),
      onDidRenameWorkspace: event("rename"),
      onDidDeleteWorkspace: event("delete"),
      onDidSwitchWorkspace: event("switch"),
      onDidChangeWorkspaceList: event("list"),
    },
  };
});

afterEach(() => {
  state.names = [];
  state.markerOf = async () => null;
});

/** The hook's map as a plain object, for `toEqual` */
const shown = (markers: ReadonlyMap<string, string>) =>
  Object.fromEntries(markers);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useSyncMarkers", () => {
  it("reads every workspace's marker, by name, leaving clean ones out", async () => {
    state.names = ["counter", "voting"];
    state.markerOf = async (_, name) =>
      name === "voting" ? "this-browser" : null;
    const { result } = renderHook(() => useSyncMarkers());
    await waitFor(() =>
      expect(shown(result.current)).toEqual({ voting: "this-browser" })
    );
  });

  it("answers a workspace named after an object's own members with its own marker", async () => {
    state.names = ["constructor", "toString"];
    state.markerOf = async (_, name) =>
      name === "toString" ? "not-synced" : null;
    const { result } = renderHook(() => useSyncMarkers());
    await waitFor(() =>
      expect(result.current.get("toString")).toBe("not-synced")
    );
    expect(result.current.get("constructor")).toBeUndefined();
  });

  it.each([
    ["sync says a marker may have moved", () => sources.sync.fire()],
    ["the session changes", () => sources.session.fire()],
    ["a workspace is created", () => sources.explorer.create.fire()],
    ["a workspace is renamed", () => sources.explorer.rename.fire()],
    ["a workspace is deleted", () => sources.explorer.delete.fire()],
    ["the open workspace switches", () => sources.explorer.switch.fire()],
    ["the workspace list changes", () => sources.explorer.list.fire()],
  ])("reads again when %s", async (_, fire) => {
    state.names = ["counter"];
    const { result } = renderHook(() => useSyncMarkers());
    await waitFor(() => expect(shown(result.current)).toEqual({}));

    state.markerOf = async () => "not-synced";
    act(fire);
    await waitFor(() =>
      expect(shown(result.current)).toEqual({ counter: "not-synced" })
    );
  });

  it("drops every marker once the session ends and sync answers none", async () => {
    state.names = ["counter"];
    state.markerOf = async () => "this-browser";
    const { result } = renderHook(() => useSyncMarkers());
    await waitFor(() =>
      expect(shown(result.current)).toEqual({ counter: "this-browser" })
    );

    state.markerOf = async () => null;
    act(() => sources.session.fire());
    await waitFor(() => expect(shown(result.current)).toEqual({}));
  });

  it("follows a rename to the new name", async () => {
    state.names = ["counter"];
    state.markerOf = async () => "this-browser";
    const { result } = renderHook(() => useSyncMarkers());
    await waitFor(() =>
      expect(shown(result.current)).toEqual({ counter: "this-browser" })
    );

    state.names = ["tally"];
    act(() => sources.explorer.rename.fire());
    await waitFor(() =>
      expect(shown(result.current)).toEqual({ tally: "this-browser" })
    );
  });

  it("queues one read behind a running one, never a second alongside", async () => {
    state.names = ["counter"];
    let release = () => {};
    let reads = 0;
    let running = 0;
    let overlapped = false;
    state.markerOf = async () => {
      reads += 1;
      running += 1;
      overlapped ||= running > 1;
      await new Promise<void>((resolve) => (release = resolve));
      running -= 1;
      return null;
    };
    renderHook(() => useSyncMarkers());
    await waitFor(() => expect(reads).toBe(1));

    // Three changes during the read: one more read, after it
    act(() => {
      sources.sync.fire();
      sources.sync.fire();
      sources.sync.fire();
    });
    release();
    await waitFor(() => expect(reads).toBe(2));
    release();
    await tick();
    expect(reads).toBe(2);
    expect(overlapped).toBe(false);
  });

  it("keeps a row's marker when its read fails, rather than show it as saved", async () => {
    state.names = ["counter"];
    state.markerOf = async () => "not-synced";
    const { result } = renderHook(() => useSyncMarkers());
    await waitFor(() =>
      expect(shown(result.current)).toEqual({ counter: "not-synced" })
    );

    state.markerOf = async () => {
      throw new Error("store busy");
    };
    act(() => sources.sync.fire());
    await tick();
    expect(shown(result.current)).toEqual({ counter: "not-synced" });
  });

  it("keeps the same map when nothing moved, so rows do not re-render", async () => {
    state.names = ["counter"];
    state.markerOf = async () => "this-browser";
    const { result } = renderHook(() => useSyncMarkers());
    await waitFor(() =>
      expect(shown(result.current)).toEqual({ counter: "this-browser" })
    );
    const first = result.current;
    act(() => sources.sync.fire());
    await tick();
    expect(result.current).toBe(first);
  });

  it("stops reading once unmounted", async () => {
    state.names = ["counter"];
    const read = vi.fn(async () => null);
    state.markerOf = read;
    const { unmount } = renderHook(() => useSyncMarkers());
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    unmount();
    sources.sync.fire();
    await tick();
    expect(read).toHaveBeenCalledOnce();
  });
});
