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
  currentWorkspaceId: undefined as string | undefined,
  isTemporary: false,
  init: vi.fn(),
  created: [] as Array<() => void>,
  switched: [] as Array<() => void>,
  inited: [] as Array<() => void>,
  deleted: [] as Array<() => void>,
  onDidCreateWorkspace: vi.fn(),
  onDidSwitchWorkspace: vi.fn(),
  onDidInit: vi.fn(),
  onDidDeleteWorkspace: vi.fn(),
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
  explorer.isTemporary = false;
  explorer.currentWorkspaceId = undefined;
  explorer.created = [];
  explorer.switched = [];
  explorer.inited = [];
  explorer.deleted = [];
  explorer.onDidInit.mockImplementation(sub(explorer.inited));
  explorer.onDidDeleteWorkspace.mockImplementation(sub(explorer.deleted));
  explorer.init.mockReset().mockResolvedValue(undefined);
  explorer.onDidCreateWorkspace.mockImplementation(sub(explorer.created));
  explorer.onDidSwitchWorkspace.mockImplementation(sub(explorer.switched));
  router.location.pathname = "/";
  router.changed = [];
  // As `PgRouter.onDidChangePath` does: the current path at once, then each
  router.onDidChangePath.mockImplementation((cb: (path: string) => void) => {
    const subscription = sub(router.changed)(cb);
    cb(router.location.pathname);
    return subscription;
  });
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
  // The links to a page go on to `/`, so they start as `/` does
  ["/programs", [], undefined, "home"],
  ["/tutorials", undefined, undefined, "pending"],
  ["/programs", ["a"], "a", "work"],
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
  expect(result.current.view).toBe("pending");
  await act(async () => {});
  expect(result.current.view).toBe("home");
});

it("never inits the explorer off `/`", () => {
  router.location.pathname = "/tutorials/hello";
  const { result } = renderHook(() => useStartView());
  expect(result.current.view).toBe("work");
  expect(explorer.init).not.toHaveBeenCalled();
});

it("leaves Home when a project is created", async () => {
  noProjects();
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  // `createWorkspace` switches to the new project before it announces it
  explorer.allWorkspaceNames = ["a"];
  explorer.currentWorkspaceName = "a";
  act(() => explorer.created.forEach((cb) => cb()));
  expect(result.current.view).toBe("work");
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
  expect(result.current.view).toBe("home");
  // The session then opens the newest one
  explorer.currentWorkspaceName = "Hello Anchor";
  act(() => explorer.switched.forEach((cb) => cb()));
  expect(result.current.view).toBe("work");
});

it("leaves Home when a tutorial route opens", async () => {
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = [];
  });
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  act(() => router.changed.forEach((cb) => cb("/tutorials/hello")));
  expect(result.current.view).toBe("work");
});

it("stays on Home while a link to a page goes on to the start route", async () => {
  router.location.pathname = "/programs";
  noProjects();
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current.view).toBe("home");
  act(() => router.changed.forEach((cb) => cb("/programs")));
  act(() => router.changed.forEach((cb) => cb("/")));
  expect(result.current.view).toBe("home");
});

it("falls back to the work and reports when the explorer fails", async () => {
  explorer.init.mockRejectedValue(new Error("idb"));
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current.view).toBe("work");
  expect(logs.entries.some((e) => e.report)).toBe(true);
});

it("falls back to the work and reports when the explorer lists nothing after init", async () => {
  // `init` resolved but left the list unset: a broken explorer, not a first
  // visit, so it must not pass for "no project"
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current.view).toBe("work");
  expect(logs.entries).toHaveLength(1);
  expect(logs.entries[0].ns).toBe("home:start");
  expect(logs.entries[0].report).toBe(true);
});

it("opens on the work without an init when the projects are already known", () => {
  explorer.allWorkspaceNames = ["a"];
  explorer.currentWorkspaceName = "a";
  const { result } = renderHook(() => useStartView());
  expect(result.current.view).toBe("work");
  expect(explorer.init).not.toHaveBeenCalled();
});

it("opens on the work when the explorer finds projects", async () => {
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = ["a"];
    explorer.currentWorkspaceName = "a";
  });
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current.view).toBe("work");
});

it("stays on Home when the explorer finds projects but none is open", async () => {
  explorer.init.mockImplementation(async () => {
    explorer.allWorkspaceNames = ["Hello Anchor"];
  });
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  expect(result.current.view).toBe("home");
  explorer.currentWorkspaceName = "Hello Anchor";
  act(() => explorer.switched.forEach((cb) => cb()));
  expect(result.current.view).toBe("work");
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
    expect(result.current.view).toBe("pending");
    expect(logs.entries).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.view).toBe("work");
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
    expect(result.current.view).toBe("home");
    act(() => vi.advanceTimersByTime(START_TIMEOUT_MS));
    expect(result.current.view).toBe("home");
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
  expect(result.current.view).toBe("home");
  expect(explorer.created).toHaveLength(1);
  unmount();
  expect(explorer.created).toEqual([]);
  expect(explorer.switched).toEqual([]);
  expect(explorer.inited).toEqual([]);
  expect(explorer.deleted).toEqual([]);
  expect(router.changed).toEqual([]);
});

it("stays on Home when a switch leaves no project open", async () => {
  noProjects();
  const { result } = renderHook(() => useStartView());
  await act(async () => {});
  act(() => explorer.switched.forEach((cb) => cb()));
  expect(result.current.view).toBe("home");
});

it("reports Home shown once", async () => {
  noProjects();
  const { result, rerender } = renderHook(() => useStartView());
  await act(async () => {});
  rerender();
  act(() => explorer.switched.forEach((cb) => cb()));
  expect(result.current.view).toBe("home");
  expect(sent.events).toEqual([
    expect.objectContaining({ name: "home_shown", params: { via: "start" } }),
  ]);
});

/** The work with project "a" open on `/`, as a page load finds it */
const onTheWork = async () => {
  explorer.allWorkspaceNames = ["a"];
  explorer.currentWorkspaceName = "a";
  const hook = renderHook(() => useStartView());
  await act(async () => {});
  expect(hook.result.current.view).toBe("work");
  return hook;
};
const lastDeleted = () => {
  explorer.allWorkspaceNames = [];
  explorer.currentWorkspaceName = undefined;
};
const fire = (list: Array<() => void>) => act(() => list.forEach((cb) => cb()));
const names = () => sent.events.map((e) => [e.name, e.params]);

describe("from an open project", () => {
  it("comes back to Home from the navigation, keeping the work", async () => {
    const { result } = await onTheWork();
    act(() => result.current.showHome("nav"));
    expect(result.current.view).toBe("home");
    expect(result.current.workKept).toBe(true);
    expect(names()).toEqual([["home_shown", { via: "nav" }]]);
  });

  it("goes back to the open project, and says how", async () => {
    const { result } = await onTheWork();
    act(() => result.current.showHome("nav"));
    act(() => result.current.leaveHome("current-project"));
    expect(result.current.view).toBe("work");
    expect(names()).toEqual([
      ["home_shown", { via: "nav" }],
      ["home_left", { via: "current-project" }],
    ]);
  });

  it("leaves when another project opens, and says so", async () => {
    explorer.allWorkspaceNames = ["a", "b"];
    const { result } = await onTheWork();
    act(() => result.current.showHome("nav"));
    explorer.currentWorkspaceName = "b";
    fire(explorer.switched);
    expect(result.current.view).toBe("work");
    expect(names()).toContainEqual(["home_left", { via: "open" }]);
  });

  it.each([
    ["the delete here", "deleted"],
    ["a switch to none", "switched"],
    ["another tab's delete, read by init", "inited"],
  ] as const)("shows Home after %s of the last project", async (_, list) => {
    const { result } = await onTheWork();
    lastDeleted();
    fire(explorer[list]);
    expect(result.current.view).toBe("home");
    expect(result.current.workKept).toBe(false);
    expect(names()).toEqual([["home_shown", { via: "last-deleted" }]]);
  });

  it("never reads a temporary project as deleted", async () => {
    const { result } = await onTheWork();
    lastDeleted();
    explorer.isTemporary = true;
    fire(explorer.switched);
    fire(explorer.inited);
    expect(result.current.view).toBe("work");
  });

  it("stays on a route other than / with no project open", async () => {
    router.location.pathname = "/tutorials/hello";
    const { result } = renderHook(() => useStartView());
    fire(explorer.inited);
    expect(result.current.view).toBe("work");
    expect(result.current.workKept).toBe(true);
  });

  it("shows Home on a way back to / with no project open", async () => {
    router.location.pathname = "/tutorials/hello";
    const { result } = renderHook(() => useStartView());
    router.location.pathname = "/";
    act(() => router.changed.forEach((cb) => cb("/")));
    expect(result.current.view).toBe("home");
    expect(names()).toEqual([["home_shown", { via: "back" }]]);
  });

  it("stays on the work on a way back to / with a project open", async () => {
    explorer.allWorkspaceNames = ["a"];
    explorer.currentWorkspaceName = "a";
    router.location.pathname = "/tutorials/hello";
    const { result } = renderHook(() => useStartView());
    router.location.pathname = "/";
    act(() => router.changed.forEach((cb) => cb("/")));
    expect(result.current.view).toBe("work");
  });

  it("does not leave Home for the work while nothing can be drawn", async () => {
    noProjects();
    const { result } = renderHook(() => useStartView());
    await act(async () => {});
    act(() => result.current.leaveHome("continue"));
    expect(result.current.view).toBe("home");
    expect(names()).toEqual([["home_shown", { via: "start" }]]);
  });

  it("ignores the navigation's Home until the start is decided", async () => {
    const { result } = renderHook(() => useStartView());
    expect(result.current.view).toBe("pending");
    act(() => result.current.showHome("nav"));
    expect(result.current.view).toBe("pending");
    // The explorer's answer decides the start after the last assertion
    await act(async () => {});
  });

  it("keeps Home and stops keeping the work when the last project goes while Home shows", async () => {
    const { result } = await onTheWork();
    act(() => result.current.showHome("nav"));
    lastDeleted();
    fire(explorer.deleted);
    fire(explorer.switched);
    expect(result.current.view).toBe("home");
    expect(result.current.workKept).toBe(false);
    expect(names()).toEqual([["home_shown", { via: "nav" }]]);
  });

  it("stays on Home when sync re-opens the project already open", async () => {
    const { result } = await onTheWork();
    act(() => result.current.showHome("nav"));
    fire(explorer.switched);
    fire(explorer.inited);
    expect(result.current.view).toBe("home");
    expect(names()).toEqual([["home_shown", { via: "nav" }]]);
  });

  it("says once that it left when a new project switches, then announces itself", async () => {
    const { result } = await onTheWork();
    act(() => result.current.showHome("nav"));
    explorer.allWorkspaceNames = ["a", "b"];
    explorer.currentWorkspaceName = "b";
    act(() => {
      explorer.switched.forEach((cb) => cb());
      explorer.created.forEach((cb) => cb());
    });
    expect(result.current.view).toBe("work");
    expect(names()).toEqual([
      ["home_shown", { via: "nav" }],
      ["home_left", { via: "open" }],
    ]);
  });

  it("says nothing when the open project is picked on the work", async () => {
    const { result } = await onTheWork();
    act(() => result.current.leaveHome("current-project"));
    expect(result.current.view).toBe("work");
    expect(names()).toEqual([]);
  });

  it("stays on Home opened from a lesson's route", async () => {
    explorer.allWorkspaceNames = ["a"];
    explorer.currentWorkspaceName = "a";
    router.location.pathname = "/tutorials/hello/2";
    const { result } = renderHook(() => useStartView());
    act(() => result.current.showHome("nav"));
    expect(result.current.view).toBe("home");
    expect(names()).toEqual([["home_shown", { via: "nav" }]]);
  });

  it("says the last project went when a lesson's route sends it to /", async () => {
    explorer.allWorkspaceNames = ["Hello"];
    explorer.currentWorkspaceName = "Hello";
    router.location.pathname = "/tutorials/hello/2";
    const { result } = renderHook(() => useStartView());
    lastDeleted();
    fire(explorer.switched);
    fire(explorer.deleted);
    expect(result.current.view).toBe("work");
    router.location.pathname = "/";
    act(() => router.changed.forEach((cb) => cb("/")));
    expect(result.current.view).toBe("home");
    expect(names()).toEqual([["home_shown", { via: "last-deleted" }]]);
  });

  it("goes back to a shared project from the navigation's Home, which the list cannot name", () => {
    router.location.pathname = "/share/abc";
    explorer.isTemporary = true;
    const { result } = renderHook(() => useStartView());
    act(() => result.current.showHome("nav"));
    expect(result.current.view).toBe("home");
    act(() => result.current.showHome("nav"));
    expect(result.current.view).toBe("work");
    expect(names()).toEqual([
      ["home_shown", { via: "nav" }],
      ["home_left", { via: "nav" }],
    ]);
  });

  it("stays on Home from the navigation's Home over a project the list names", async () => {
    const { result } = await onTheWork();
    act(() => result.current.showHome("nav"));
    act(() => result.current.showHome("nav"));
    expect(result.current.view).toBe("home");
  });

  it("stays on Home when sync renames the project it shows over", async () => {
    explorer.currentWorkspaceId = "id-a";
    const { result } = await onTheWork();
    act(() => result.current.showHome("nav"));
    // A rename from another device re-opens the same project by a new name
    explorer.allWorkspaceNames = ["renamed"];
    explorer.currentWorkspaceName = "renamed";
    fire(explorer.switched);
    expect(result.current.view).toBe("home");
  });

  it("says it left for a route", async () => {
    const { result } = await onTheWork();
    act(() => result.current.showHome("nav"));
    router.location.pathname = "/tutorials/hello";
    act(() => router.changed.forEach((cb) => cb("/tutorials/hello")));
    expect(result.current.view).toBe("work");
    expect(names()).toContainEqual(["home_left", { via: "open" }]);
  });
});
