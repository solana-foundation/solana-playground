import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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
import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";

/**
 * A stand-in for the explorer: the `@/utils` barrel needs a booted app. It
 * holds names, ids and the open one, and fires its events on `emit`.
 */
const app = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const on = (cb: () => void) => {
    listeners.add(cb);
    return { dispose: () => listeners.delete(cb) };
  };
  const state = {
    names: [] as string[],
    ids: {} as Record<string, string>,
    current: null as string | null,
    lessons: [] as string[],
  };
  return {
    state,
    emit: () => listeners.forEach((listener) => listener()),
    PgExplorer: {
      get allWorkspaceNames() {
        return state.names;
      },
      get currentWorkspaceName() {
        return state.current;
      },
      workspaceIdOf: (name: string) => state.ids[name],
      isWorkspaceNameValid: (name: string) => /^(?!\s)[\w\s-]+$/.test(name),
      switchWorkspace: vi.fn(),
      renameWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      fs: { readDir: vi.fn(), getMetadata: vi.fn(), readToString: vi.fn() },
      onDidCreateWorkspace: on,
      onDidRenameWorkspace: on,
      onDidDeleteWorkspace: on,
      onDidSwitchWorkspace: on,
      onDidChangeWorkspaceList: on,
    },
    PgTutorial: {
      isWorkspaceTutorial: (name: string) => state.lessons.includes(name),
      open: vi.fn(),
    },
    PgView: { setModal: vi.fn(), setToast: vi.fn() },
  };
});
vi.mock("@/utils", () => ({
  PgExplorer: app.PgExplorer,
  PgTutorial: app.PgTutorial,
  PgView: app.PgView,
}));
const modals = vi.hoisted(() => ({
  DeleteWorkspace: () => null,
  ExportWorkspace: () => null,
}));
vi.mock("@/views/sidebar/explorer/Component/Modals", () => modals);
const files = vi.hoisted(() => ({ readWorkspaceFiles: vi.fn() }));
vi.mock("../model/workspace-files", async (importOriginal) => ({
  rebaseFiles: (
    (await importOriginal()) as typeof import("../model/workspace-files")
  ).rebaseFiles,
  readWorkspaceFiles: files.readWorkspaceFiles,
}));

// The markers' reading is `use-sync-markers.test.tsx`'s; here, only where
// they land
const syncMarkers = vi.hoisted(() => ({
  current: new Map<string, "this-browser" | "not-synced">(),
}));
vi.mock("./use-sync-markers", () => ({
  useSyncMarkers: () => syncMarkers.current,
}));

import { PINS_KEY } from "../model/pins";
import ProjectList from "./ProjectList";

// The stock Sidebar reads the viewport through `matchMedia`, which jsdom lacks
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});
afterAll(() => {
  vi.unstubAllGlobals();
});

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  app.state.names = ["alpha", "beta", "Hello Anchor"];
  app.state.ids = { alpha: "id-a", beta: "id-b", "Hello Anchor": "id-h" };
  app.state.current = "beta";
  app.state.lessons = ["Hello Anchor"];
  vi.clearAllMocks();
  app.PgExplorer.renameWorkspace.mockResolvedValue(undefined);
  app.PgExplorer.createWorkspace.mockResolvedValue(undefined);
  app.PgExplorer.switchWorkspace.mockResolvedValue(undefined);
  app.PgTutorial.open.mockResolvedValue(undefined);
  app.PgView.setModal.mockResolvedValue(null);
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  localStorage.clear();
  resetTelemetry();
  resetLogger();
  syncMarkers.current = new Map();
});

const onPickCurrent = vi.fn();
const draw = (onPicked?: () => void) =>
  render(
    <TooltipProvider>
      <SidebarProvider>
        <ProjectList onPickCurrent={onPickCurrent} onPicked={onPicked} />
      </SidebarProvider>
    </TooltipProvider>
  );

const menuOf = (name: string) => {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: `Actions for ${name}` }),
    { button: 0, ctrlKey: false }
  );
  return screen.getByRole("menu");
};

const projectNames = () =>
  within(screen.getByRole("group", { name: "Projects" }))
    .getAllByRole("button", { name: /^(alpha|beta|gamma)$/ })
    .map((button) => button.textContent);

const events = (name: string) =>
  sent.events.filter((e) => e.name === name).map((e) => e.params);

const toasts = () =>
  app.PgView.setToast.mock.calls.map(
    ([, props]) => (props as { options: { name: string } }).options.name
  );

describe("ProjectList", () => {
  it("puts each workspace's sync marker on its own row, by name", () => {
    syncMarkers.current = new Map([["alpha", "this-browser"]]);
    draw();
    const projects = screen.getByRole("group", { name: "Projects" });
    const describedBy = (name: string) =>
      within(projects)
        .getByRole("button", { name })
        .getAttribute("aria-describedby");
    expect(
      document.getElementById(describedBy("alpha") ?? "")?.textContent
    ).toBe("This browser");
    expect(describedBy("beta")).toBeNull();
  });

  it("pins by key, keeps the pin by id, and lists the pinned first", () => {
    draw();
    expect(projectNames()).toEqual(["alpha", "beta"]);

    fireEvent.keyDown(menuOf("beta"), { key: "p" });

    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual(["id-b"]);
    expect(projectNames()).toEqual(["beta", "alpha"]);
    expect(events("nav_project_action")).toEqual([
      { action: "pin", via: "key" },
    ]);
  });

  it("drops a stored pin no workspace has", () => {
    localStorage.setItem(PINS_KEY, JSON.stringify(["id-a", "gone"]));
    draw();
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual(["id-a"]);
  });

  it("renames in place through the explorer, announced for sync", async () => {
    draw();
    fireEvent.click(
      within(menuOf("alpha")).getByRole("menuitem", { name: "Rename alpha" })
    );
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    fireEvent.change(field, { target: { value: "gamma" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(app.PgExplorer.renameWorkspace).toHaveBeenCalledWith("gamma", {
        from: "alpha",
        announce: true,
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Rename alpha" })).toBeNull()
    );
    expect(events("nav_project_action")).toEqual([
      { action: "rename", via: "click" },
    ]);
  });

  it.each([
    ["beta", "A project named beta already exists."],
    ["bad/name", "Use letters, digits, spaces, - and _."],
    ["   ", "Use letters, digits, spaces, - and _."],
  ])("keeps the field open for %j and says why", (value, message) => {
    draw();
    fireEvent.keyDown(menuOf("alpha"), { key: "r" });
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    fireEvent.change(field, { target: { value } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(app.PgExplorer.renameWorkspace).not.toHaveBeenCalled();
  });

  it("tells the user a rename failed, and reports it", async () => {
    // Not one of the refusals the field explains: the store itself failed
    const failure = new Error("QuotaExceededError");
    app.PgExplorer.renameWorkspace.mockRejectedValue(failure);
    draw();
    fireEvent.keyDown(menuOf("alpha"), { key: "r" });
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    fireEvent.change(field, { target: { value: "gamma" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(toasts()).toEqual(["project-rename-failed"]));
    expect(events("nav_project_action")).toEqual([
      { action: "rename", via: "key" },
    ]);
    expect(events("nav_project_action_failed")).toEqual([{ action: "rename" }]);
    expect(logged.entries).toEqual([
      expect.objectContaining({
        ns: "app-nav:projects",
        error: failure,
        report: true,
      }),
    ]);
  });

  it("duplicates into the next free copy name, from the store", async () => {
    app.state.names = ["alpha", "alpha copy", "beta"];
    files.readWorkspaceFiles.mockResolvedValue([
      ["/alpha/src/lib.rs", "fn main() {}"],
    ]);
    draw();

    fireEvent.keyDown(menuOf("alpha"), { key: "d" });

    await waitFor(() =>
      expect(app.PgExplorer.createWorkspace).toHaveBeenCalledWith(
        "alpha copy 2",
        { files: [["/alpha copy 2/src/lib.rs", "fn main() {}"]] }
      )
    );
    expect(files.readWorkspaceFiles).toHaveBeenCalledWith(
      "alpha",
      app.PgExplorer.fs
    );
  });

  it("opens a project by switching, a lesson through the tutorial", async () => {
    onPickCurrent.mockReset();
    draw();
    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    await waitFor(() =>
      expect(app.PgExplorer.switchWorkspace).toHaveBeenCalledWith("alpha")
    );

    fireEvent.click(screen.getByRole("button", { name: "Hello Anchor" }));
    await waitFor(() =>
      expect(app.PgTutorial.open).toHaveBeenCalledWith("Hello Anchor")
    );
    expect(onPickCurrent).not.toHaveBeenCalled();
  });

  it("hands the project already open back to the page, without a switch", async () => {
    onPickCurrent.mockReset();
    draw();
    fireEvent.click(screen.getByRole("button", { name: "beta" }));
    await waitFor(() => expect(onPickCurrent).toHaveBeenCalledTimes(1));
    expect(app.PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  });

  it("says a project was picked, the one already open included", () => {
    const onPicked = vi.fn();
    draw(onPicked);
    fireEvent.click(screen.getByRole("button", { name: "beta" }));
    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    expect(onPicked).toHaveBeenCalledTimes(2);
  });

  it("hands export and delete to their dialogs, with the project's name", () => {
    draw();
    fireEvent.keyDown(menuOf("alpha"), { key: "e" });
    fireEvent.keyDown(menuOf("Hello Anchor"), { key: "Delete" });

    const [exported, deleted] = app.PgView.setModal.mock.calls.map(
      ([element]) => element as ReactElement<Record<string, unknown>>
    );
    expect(exported.type).toBe(modals.ExportWorkspace);
    expect(exported.props).toEqual({ name: "alpha" });
    expect(deleted.type).toBe(modals.DeleteWorkspace);
    expect(deleted.props).toEqual({ name: "Hello Anchor", isLesson: true });
  });

  it("follows the explorer: a project created elsewhere appears", () => {
    draw();
    act(() => {
      app.state.names = ["alpha", "beta", "gamma"];
      app.state.ids = { alpha: "id-a", beta: "id-b", gamma: "id-g" };
      app.emit();
    });
    expect(projectNames()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("renames a name typed with a leading space, trimmed", async () => {
    draw();
    fireEvent.keyDown(menuOf("alpha"), { key: "r" });
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    fireEvent.change(field, { target: { value: " gamma" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(app.PgExplorer.renameWorkspace).toHaveBeenCalledWith("gamma", {
        from: "alpha",
        announce: true,
      })
    );
  });

  it("starts one rename however often Enter is pressed while it runs", async () => {
    let finish = () => {};
    app.PgExplorer.renameWorkspace.mockReturnValue(
      new Promise<void>((resolve) => (finish = resolve))
    );
    draw();
    fireEvent.keyDown(menuOf("alpha"), { key: "r" });
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    fireEvent.change(field, { target: { value: "gamma" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    await act(async () => finish());

    expect(app.PgExplorer.renameWorkspace).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual([]);
  });

  it.each([
    ["Workspace not found", "alpha is no longer in your projects."],
    ["Already exists", "A project named gamma already exists."],
  ])(
    "says in the field, unreported, why a rename was refused: %s",
    async (refusal, message) => {
      app.PgExplorer.renameWorkspace.mockRejectedValue(new Error(refusal));
      draw();
      fireEvent.keyDown(menuOf("alpha"), { key: "r" });
      const field = screen.getByRole("textbox", { name: "Rename alpha" });
      fireEvent.change(field, { target: { value: "gamma" } });
      fireEvent.keyDown(field, { key: "Enter" });

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(message)
      );
      expect(toasts()).toEqual([]);
      expect(logged.entries.filter((entry) => entry.report)).toEqual([]);
      expect(events("nav_project_action_failed")).toEqual([
        { action: "rename" },
      ]);
    }
  );

  it("follows a rename made elsewhere, and drops a field for a name that went", () => {
    draw();
    fireEvent.keyDown(menuOf("alpha"), { key: "r" });
    act(() => {
      app.state.names = ["gamma", "beta", "Hello Anchor"];
      app.state.ids = { gamma: "id-a", beta: "id-b", "Hello Anchor": "id-h" };
      app.emit();
    });

    expect(screen.queryByRole("textbox", { name: "Rename alpha" })).toBeNull();
    expect(projectNames()).toEqual(["gamma", "beta"]);
    // The name coming back does not bring the field back with it
    act(() => {
      app.state.names = ["alpha", "beta", "Hello Anchor"];
      app.state.ids = { alpha: "id-a", beta: "id-b", "Hello Anchor": "id-h" };
      app.emit();
    });
    expect(screen.queryByRole("textbox", { name: "Rename alpha" })).toBeNull();
  });

  it("keeps a pin another tab made when this one pins", () => {
    draw();
    // Tab B pinned alpha after this tab read the pins
    localStorage.setItem(PINS_KEY, JSON.stringify(["id-a"]));
    fireEvent.keyDown(menuOf("beta"), { key: "p" });

    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual([
      "id-a",
      "id-b",
    ]);
  });

  it("keeps the pins while the explorer has no workspaces yet", () => {
    localStorage.setItem(PINS_KEY, JSON.stringify(["id-a"]));
    app.state.names = [];
    app.state.ids = {};
    draw();
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual(["id-a"]);

    act(() => {
      app.state.names = ["beta", "alpha"];
      app.state.ids = { alpha: "id-a", beta: "id-b" };
      app.emit();
    });
    expect(projectNames()).toEqual(["alpha", "beta"]);
  });

  it("logs the message of a dialog that failed to open, not [object Object]", async () => {
    // `PgCommon.sendAndReceiveCustomEvent` rejects with a bare `{ message }`
    app.PgView.setModal.mockRejectedValue({ message: "no modal host" });
    draw();
    fireEvent.keyDown(menuOf("alpha"), { key: "e" });

    await waitFor(() => expect(logged.entries).toHaveLength(1));
    const { error } = logged.entries[0] as { error: unknown };
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("no modal host");
  });

  it("warns once, not on every render, when stale pins cannot be dropped", () => {
    localStorage.setItem(PINS_KEY, JSON.stringify(["id-a", "gone"]));
    const refused = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    try {
      draw();
      act(() => app.emit());
      act(() => app.emit());
    } finally {
      refused.mockRestore();
    }
    expect(logged.entries).toHaveLength(1);
  });
});
