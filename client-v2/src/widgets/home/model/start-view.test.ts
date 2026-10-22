import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

const explorer = vi.hoisted(() => ({
  allWorkspaceNames: undefined as string[] | undefined,
  currentWorkspaceName: undefined as string | undefined,
  init: vi.fn(),
  created: [] as Array<() => void>,
  switched: [] as Array<() => void>,
  onDidCreateWorkspace: vi.fn(),
  onDidSwitchWorkspace: vi.fn(),
}));
const router = vi.hoisted(() => ({
  location: { pathname: "/" },
  changed: [] as Array<(path: string) => void>,
  onDidChangePath: vi.fn(),
}));
vi.mock("@/utils", () => ({ PgExplorer: explorer, PgRouter: router }));

import { decideStart, START_TIMEOUT_MS, useStartView } from "./start-view";

const sub =
  <T>(list: T[]) =>
  (cb: T) => {
    list.push(cb);
    return { dispose: () => list.splice(list.indexOf(cb), 1) };
  };

beforeEach(() => {
  explorer.allWorkspaceNames = undefined;
  explorer.currentWorkspaceName = undefined;
  explorer.created = [];
  explorer.switched = [];
  explorer.init.mockReset().mockResolvedValue(undefined);
  explorer.onDidCreateWorkspace.mockImplementation(sub(explorer.created));
  explorer.onDidSwitchWorkspace.mockImplementation(sub(explorer.switched));
  router.location.pathname = "/";
  router.changed = [];
  router.onDidChangePath.mockImplementation(sub(router.changed));
  logs = memoryLogs();
  initLogger({ providers: [logs] });
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  resetLogger();
  resetTelemetry();
});

let logs: ReturnType<typeof memoryLogs>;
let sent: ReturnType<typeof memoryProvider>;

/** The explorer's answer on a first visit: no project */
const noProjects = () =>
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = [];
  });

it.each([
  ["/tutorials/hello", [], undefined, "work"],
  ["/", undefined, undefined, "pending"],
  ["/", [], undefined, "home"],
  ["/", ["a"], "a", "work"],
  // Listed by sync but none opened: the work would throw in the explorer
  ["/", ["a"], undefined, "home"],
] as const)(
  "decideStart(%s, %j, current %s) is %s",
  (path, workspaces, current, view) => {
    expect(decideStart({ path, workspaces, current })).toBe(view);
  }
);

it("shows Home once the explorer says there is no project", async () => {
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = [];
  });
  const { result } = renderHook(() => useStartView());
  expect(result.current).toBe("pending");
  await act(async () => {});
  expect(result.current).toBe("home");
});

it("never inits the explorer off `/`", () => {
  router.location.pathname = "/tutorials/hello";
  const { result } = renderHook(() => useStartView());
  expect(result.current).toBe("work");
  expect(explorer.init).not.toHaveBeenCalled();
});

it("leaves Home when a project is created, and does not come back", async () => {
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = [];
  });
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  // `createWorkspace` switches to the new project before it announces it
  explorer.allWorkspaceNames = ["a"];
  explorer.currentWorkspaceName = "a";
  act(() => explorer.created.forEach((cb) => cb()));
  expect(result.current).toBe("work");
  explorer.allWorkspaceNames = [];
  explorer.currentWorkspaceName = undefined;
  act(() => explorer.created.forEach((cb) => cb()));
  expect(result.current).toBe("work");
});

it("stays on Home while the account's projects arrive, until one is opened", async () => {
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = [];
  });
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  // Sync imports a project without opening it: the work would mount with
  // projects listed and none current, which the explorer cannot draw
  explorer.allWorkspaceNames = ["Hello Anchor"];
  act(() => explorer.created.forEach((cb) => cb()));
  expect(result.current).toBe("home");
  // The session then opens the newest one
  explorer.currentWorkspaceName = "Hello Anchor";
  act(() => explorer.switched.forEach((cb) => cb()));
  expect(result.current).toBe("work");
});

it("leaves Home when a tutorial route opens", async () => {
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = [];
  });
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  act(() => router.changed.forEach((cb) => cb("/tutorials/hello")));
  expect(result.current).toBe("work");
});

it("falls back to the work and reports when the explorer fails", async () => {
  explorer.init.mockRejectedValue(new Error("idb"));
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current).toBe("work");
  expect(logs.entries.some((e) => e.report)).toBe(true);
});

it("falls back to the work and reports when the explorer lists nothing after init", async () => {
  // `init` resolved but left the list unset: a broken explorer, not a first
  // visit, so it must not pass for "no project"
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current).toBe("work");
  expect(logs.entries).toHaveLength(1);
  expect(logs.entries[0].ns).toBe("home:start");
  expect(logs.entries[0].report).toBe(true);
});

it("opens on the work without an init when the projects are already known", () => {
  explorer.allWorkspaceNames = ["a"];
  explorer.currentWorkspaceName = "a";
  const { result } = renderHook(() => useStartView());
  expect(result.current).toBe("work");
  expect(explorer.init).not.toHaveBeenCalled();
});

it("opens on the work when the explorer finds projects", async () => {
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = ["a"];
    explorer.currentWorkspaceName = "a";
  });
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current).toBe("work");
});

it("stays on Home when the explorer finds projects but none is open", async () => {
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = ["Hello Anchor"];
  });
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current).toBe("home");
  explorer.currentWorkspaceName = "Hello Anchor";
  act(() => explorer.switched.forEach((cb) => cb()));
  expect(result.current).toBe("work");
});

describe("when the explorer never answers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    explorer.init.mockReturnValue(new Promise(() => {}));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to the work and reports once the wait runs out", () => {
    const { result } = renderHook(() => useStartView());
    act(() => vi.advanceTimersByTime(START_TIMEOUT_MS - 1));
    expect(result.current).toBe("pending");
    expect(logs.entries).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("work");
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0].ns).toBe("home:start");
    expect(logs.entries[0].report).toBe(true);
  });

  it("stops waiting when unmounted", () => {
    const { unmount } = renderHook(() => useStartView());
    unmount();
    act(() => vi.advanceTimersByTime(START_TIMEOUT_MS));
    expect(logs.entries).toEqual([]);
  });
});

it("does not fall back once the explorer has answered", async () => {
  vi.useFakeTimers();
  try {
    noProjects();
    const { result } = renderHook(() => useStartView());
    await act(async () => {});
    expect(result.current).toBe("home");
    act(() => vi.advanceTimersByTime(START_TIMEOUT_MS));
    expect(result.current).toBe("home");
    expect(logs.entries).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("does nothing when unmounted before the explorer answers", async () => {
  let answer = () => {};
  explorer.init.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        answer = () => {
          explorer.allWorkspaceNames = [];
          resolve();
        };
      })
  );
  const { unmount } = renderHook(() => useStartView());
  unmount();
  await act(async () => answer());
  expect(explorer.onDidCreateWorkspace).not.toHaveBeenCalled();
  expect(sent.events).toEqual([]);
  expect(logs.entries).toEqual([]);
});

it("stops listening when unmounted on Home", async () => {
  noProjects();
  const { result, unmount } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current).toBe("home");
  expect(explorer.created).toHaveLength(1);
  unmount();
  expect(explorer.created).toEqual([]);
  expect(explorer.switched).toEqual([]);
  expect(router.changed).toEqual([]);
});

it("stays on Home when a switch leaves no project open", async () => {
  noProjects();
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  act(() => explorer.switched.forEach((cb) => cb()));
  expect(result.current).toBe("home");
});

it("reports Home shown once", async () => {
  noProjects();
  const { result, rerender } = renderHook(() => useStartView());
  await act(async () => {});
  rerender();
  act(() => explorer.switched.forEach((cb) => cb()));
  expect(result.current).toBe("home");
  expect(sent.events.map((e) => e.name)).toEqual(["home_shown"]);
});
