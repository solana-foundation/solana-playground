import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

const utils = vi.hoisted(() => ({
  PgTutorial: {
    all: [] as unknown[],
    open: vi.fn(),
    isWorkspaceTutorial: vi.fn(),
  },
  PgView: { setModal: vi.fn(), setToast: vi.fn() },
  PgCommon: { fetchJSON: vi.fn() },
  PgExplorer: {
    currentWorkspaceName: undefined as string | undefined,
    allWorkspaceNames: [] as string[],
    switchWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    onDidSwitchWorkspace: vi.fn(),
    onDidInit: vi.fn(),
  },
  PgFramework: { get: vi.fn() },
  PgCommand: { build: { execute: vi.fn() } },
  PgGlobal: { buildLoading: false as boolean },
  isTerminalUnmounted: (e: unknown) => e === UNMOUNTED,
}));
/** What the terminal answers before the work under Home has mounted it */
const UNMOUNTED = vi.hoisted(() => new Error("terminal unmounted"));
vi.mock("@/utils", () => utils);
vi.mock("@/hooks", () => ({ useRenderOnChange: () => {} }));
const session = vi.hoisted(() => ({
  get: vi.fn(),
  onDidChange: vi.fn(),
  readState: "answered" as "unread" | "failed" | "answered",
  refresh: vi.fn(),
  whenRead: vi.fn(),
}));
vi.mock("@/features/auth", () => ({ PgSession: session }));
const accountList = vi.hoisted(() => ({
  state: "empty" as "unknown" | "empty" | "holds",
  onDidChange: vi.fn(),
}));
vi.mock("@/features/persistence", () => ({ PgAccountList: accountList }));
// Home only hands Start from scratch on; its own tests cover it
vi.mock("@/features/new-project", () => ({
  StartFromScratch: () => <div data-testid="scratch" />,
}));

import Home from "./Home";

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
/** 34 programs, each complete, as the listing the count is read from */
const LISTING = Array.from({ length: 34 }, (_, i) => ({
  name: `p${i}`,
  description: "d",
  repo: `https://github.com/x/p${i}`,
  icon: "/i.png",
  framework: "Anchor",
  categories: [],
}));

beforeEach(() => {
  utils.PgTutorial.all = [
    {
      name: "Hello Anchor",
      description: "d",
      level: "Beginner",
      framework: "Anchor",
      thumbnail: "/t.png",
    },
  ];
  utils.PgTutorial.open.mockReset().mockResolvedValue(undefined);
  utils.PgView.setModal.mockReset().mockResolvedValue(null);
  utils.PgView.setToast.mockReset();
  utils.PgCommon.fetchJSON.mockReset().mockResolvedValue(LISTING);
  utils.PgTutorial.isWorkspaceTutorial
    .mockReset()
    .mockImplementation((name: string) => name === "Hello Anchor");
  utils.PgExplorer.currentWorkspaceName = undefined;
  utils.PgExplorer.allWorkspaceNames = [];
  utils.PgExplorer.switchWorkspace.mockReset().mockResolvedValue(undefined);
  // Making a project opens it, as the explorer does
  utils.PgExplorer.createWorkspace
    .mockReset()
    .mockImplementation(async (name: string) => {
      utils.PgExplorer.allWorkspaceNames = [name];
      utils.PgExplorer.currentWorkspaceName = name;
    });
  utils.PgFramework.get.mockReset().mockReturnValue({
    defaultOpenFile: "/src/lib.rs",
    getDefaultFiles: async () => ({ files: [["/src/lib.rs", "// anchor"]] }),
  });
  utils.PgCommand.build.execute.mockReset().mockResolvedValue(undefined);
  session.get.mockReset().mockReturnValue(null);
  session.readState = "answered";
  accountList.state = "empty";
  session.refresh.mockReset().mockResolvedValue(undefined);
  session.whenRead.mockReset().mockResolvedValue(undefined);
  utils.PgGlobal.buildLoading = false;
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
});

const draw = () => {
  const onAsk = vi.fn();
  const onOpenPage = vi.fn();
  const onContinue = vi.fn();
  render(
    <Home onAsk={onAsk} onOpenPage={onOpenPage} onContinue={onContinue} />
  );
  return {
    home: within(screen.getByRole("region", { name: "Home" })),
    onAsk,
    onOpenPage,
    onContinue,
  };
};
const events = (name: string) =>
  sent.events.filter((e) => e.name === name).map((e) => e.params);

it("opens the Programs page from the programs tile, and no gallery", async () => {
  const { home, onOpenPage } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Open a program" }));
  expect(onOpenPage).toHaveBeenCalledWith("programs");
  expect(utils.PgView.setModal).not.toHaveBeenCalled();
  expect(events("home_tile_opened")).toEqual([{ tile: "programs" }]);
});

it("opens the Tutorials page from the tile and from All", async () => {
  const { home, onOpenPage } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Follow a tutorial" }));
  fireEvent.click(home.getByRole("button", { name: "All 1" }));
  expect(onOpenPage.mock.calls).toEqual([["tutorials"], ["tutorials"]]);
  expect(utils.PgView.setModal).not.toHaveBeenCalled();
});

it("reports New project and unfolds the scratch options", async () => {
  const { home } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "New project" }));
  expect(events("home_tile_opened")).toEqual([{ tile: "new-project" }]);
  expect(home.getByTestId("scratch")).toBeTruthy();
});

it("opens a tutorial and reports it", async () => {
  const { home } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Open Hello Anchor" }));
  await waitFor(() => expect(events("home_tutorial_opened")).toHaveLength(1));
  expect(utils.PgTutorial.open).toHaveBeenCalledWith("Hello Anchor");
});

it("tells the user once when a tutorial fails to open, and frees the button", async () => {
  const failure = new Error("no such tutorial");
  utils.PgTutorial.open.mockRejectedValueOnce(failure);
  const { home } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Open Hello Anchor" }));
  await home.findByText("no such tutorial");
  expect(logged.entries).toHaveLength(1);
  expect(logged.entries[0].ns).toBe("home:actions");
  expect(logged.entries[0].report).toBe(true);
  expect(logged.entries[0].error).toBe(failure);
  expect(events("home_tutorial_opened")).toEqual([]);
  await waitFor(() =>
    expect(
      (
        home.getByRole("button", {
          name: "Open Hello Anchor",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
});

it("shows the message of a tutorial failure that is not an Error", async () => {
  utils.PgTutorial.open.mockRejectedValueOnce({ message: "quota exceeded" });
  const { home } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Open Hello Anchor" }));
  expect(await home.findByText("quota exceeded")).toBeTruthy();
});

it("opens the assistant from the composer and reports it", async () => {
  const { home, onAsk } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Ask the assistant" }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(events("home_composer_opened")).toEqual([{}]);
});

it("reads the program count from the registry", async () => {
  const { home } = draw();
  await home.findByText("34 real programs");
  expect(utils.PgCommon.fetchJSON).toHaveBeenCalledWith(
    "/programs/programs.json"
  );
});

it("shows an ellipsis and logs quietly when the registry cannot be read", async () => {
  const failure = new Error("offline");
  utils.PgCommon.fetchJSON.mockRejectedValueOnce(failure);
  const { home } = draw();
  await waitFor(() =>
    expect(logged.entries.some((e) => e.error === failure)).toBe(true)
  );
  expect(home.getByText("… real programs")).toBeTruthy();
  expect(logged.entries.find((e) => e.error === failure)?.report).toBe(false);
  expect(logged.entries.find((e) => e.error === failure)?.ns).toBe(
    "home:programs"
  );
});

it("keeps the ellipsis and logs the URL when the registry is not a list", async () => {
  utils.PgCommon.fetchJSON.mockResolvedValueOnce({ programs: [] });
  const { home } = draw();
  await waitFor(() => expect(logged.entries).toHaveLength(1));
  expect(home.getByText("… real programs")).toBeTruthy();
  expect(logged.entries[0].ns).toBe("home:programs");
  expect(logged.entries[0].report).toBe(false);
  expect(String(logged.entries[0].error)).toContain("/programs/programs.json");
});

it("makes the example and builds it once on a first visit", async () => {
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: "Run it" }));
  await waitFor(() => expect(events("home_example_run")).toHaveLength(1));
  expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith(
    "anchor-example",
    { files: [["/src/lib.rs", "// anchor"]], defaultOpenFile: "/src/lib.rs" }
  );
  expect(utils.PgCommand.build.execute).toHaveBeenCalledTimes(1);
  expect(events("home_example_run")).toEqual([{ outcome: "created" }]);
});

it("keeps the example when its build fails to run, and reports it", async () => {
  const failure = new Error("server down");
  utils.PgCommand.build.execute.mockRejectedValueOnce(failure);
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: "Run it" }));
  await waitFor(() =>
    expect(events("home_example_run")).toEqual([{ outcome: "created" }])
  );
  // The stage may show it as an unreached server, but it could be a bug
  await waitFor(() =>
    expect(logged.entries.map((e) => [e.ns, e.error, e.report])).toEqual([
      ["home:first-run", failure, true],
    ])
  );
  expect(utils.PgView.setToast).not.toHaveBeenCalled();
});

it("builds nothing once the user has opened another project", async () => {
  utils.PgExplorer.createWorkspace.mockImplementation(async (name: string) => {
    utils.PgExplorer.allWorkspaceNames = [name, "other"];
    // Picked in the list before the terminal mounted
    utils.PgExplorer.currentWorkspaceName = "other";
  });
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: "Run it" }));
  await waitFor(() =>
    expect(events("home_example_run")).toEqual([{ outcome: "created" }])
  );
  expect(utils.PgCommand.build.execute).not.toHaveBeenCalled();
});

it("leads with nothing while the project list has not loaded", () => {
  utils.PgExplorer.allWorkspaceNames = undefined as unknown as string[];
  const { home } = draw();
  expect(home.queryByRole("region", { name: "Try an example" })).toBeNull();
  expect(
    home.queryByRole("region", { name: "Pick up where you left off" })
  ).toBeNull();
});

it("opens an example that exists, and builds nothing", async () => {
  utils.PgExplorer.allWorkspaceNames = ["anchor-example"];
  utils.PgExplorer.currentWorkspaceName = undefined;
  const { home } = draw();
  // A project exists, so Home lists it rather than offering the example
  expect(home.queryByRole("button", { name: "Run it" })).toBeNull();
  fireEvent.click(home.getByRole("button", { name: "Open anchor-example" }));
  await waitFor(() =>
    expect(utils.PgExplorer.switchWorkspace).toHaveBeenCalledWith(
      "anchor-example"
    )
  );
  expect(utils.PgCommand.build.execute).not.toHaveBeenCalled();
});

it("lists recent work on a return visit, the open project first", async () => {
  utils.PgExplorer.allWorkspaceNames = ["a", "Hello Anchor", "b", "c"];
  utils.PgExplorer.currentWorkspaceName = "a";
  const { home } = draw();
  const recent = within(
    home.getByRole("region", { name: "Pick up where you left off" })
  );
  expect(
    recent.getAllByRole("button").map((b) => b.getAttribute("aria-label"))
  ).toEqual(["Open a", "Open c", "Open b"]);
});

it("goes back to the work from the open project", async () => {
  utils.PgExplorer.allWorkspaceNames = ["a"];
  utils.PgExplorer.currentWorkspaceName = "a";
  const { home, onContinue } = draw();
  fireEvent.click(home.getByRole("button", { name: "Open a" }));
  await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1));
  expect(utils.PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  expect(events("home_recent_opened")).toEqual([{ kind: "current" }]);
});

it("opens a started tutorial at its page from the recent list", async () => {
  utils.PgExplorer.allWorkspaceNames = ["Hello Anchor"];
  const { home } = draw();
  const recent = within(
    home.getByRole("region", { name: "Pick up where you left off" })
  );
  fireEvent.click(recent.getByRole("button", { name: "Open Hello Anchor" }));
  await waitFor(() =>
    expect(events("home_recent_opened")).toEqual([{ kind: "tutorial" }])
  );
  expect(utils.PgTutorial.open).toHaveBeenCalledWith("Hello Anchor");
  expect(utils.PgExplorer.switchWorkspace).not.toHaveBeenCalled();
});

it("opens another project from the recent list", async () => {
  utils.PgExplorer.allWorkspaceNames = ["a", "b"];
  utils.PgExplorer.currentWorkspaceName = "a";
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: "Open b" }));
  await waitFor(() =>
    expect(events("home_recent_opened")).toEqual([{ kind: "project" }])
  );
  expect(utils.PgExplorer.switchWorkspace).toHaveBeenCalledWith("b");
});

it("starts the example's build once the work has mounted the terminal", async () => {
  utils.PgCommand.build.execute
    .mockRejectedValueOnce(UNMOUNTED)
    .mockRejectedValueOnce(UNMOUNTED)
    .mockResolvedValueOnce(undefined);
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: "Run it" }));
  await waitFor(
    () => expect(utils.PgCommand.build.execute).toHaveBeenCalledTimes(3),
    { timeout: 3000 }
  );
  expect(events("home_example_run")).toEqual([{ outcome: "created" }]);
  expect(logged.entries).toEqual([]);
});

it("opens the example another tab made since Home drew it, and builds nothing", async () => {
  const { home } = draw();
  utils.PgExplorer.allWorkspaceNames = ["anchor-example"];
  fireEvent.click(home.getByRole("button", { name: "Run it" }));
  await waitFor(() =>
    expect(events("home_example_run")).toEqual([{ outcome: "opened" }])
  );
  expect(utils.PgExplorer.switchWorkspace).toHaveBeenCalledWith(
    "anchor-example"
  );
  expect(utils.PgExplorer.createWorkspace).not.toHaveBeenCalled();
  expect(utils.PgCommand.build.execute).not.toHaveBeenCalled();
});

it("goes back to the example when it is already open", async () => {
  const { home, onContinue } = draw();
  utils.PgExplorer.allWorkspaceNames = ["anchor-example"];
  utils.PgExplorer.currentWorkspaceName = "anchor-example";
  fireEvent.click(home.getByRole("button", { name: "Run it" }));
  await waitFor(() =>
    expect(events("home_example_run")).toEqual([{ outcome: "current" }])
  );
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(utils.PgExplorer.switchWorkspace).not.toHaveBeenCalled();
});

it("leaves the build to the stage's Build when one already runs", async () => {
  utils.PgGlobal.buildLoading = true;
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: "Run it" }));
  await waitFor(() =>
    expect(events("home_example_run")).toEqual([{ outcome: "created" }])
  );
  await waitFor(() =>
    expect(logged.entries.map((e) => e.context)).toEqual([
      { reason: "already-building" },
    ])
  );
  expect(utils.PgCommand.build.execute).not.toHaveBeenCalled();
});

it("tells the user when the example cannot be made, and counts nothing", async () => {
  utils.PgExplorer.createWorkspace.mockRejectedValueOnce(new Error("quota"));
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: "Run it" }));
  await waitFor(() =>
    expect(logged.entries.map((e) => e.ns)).toEqual(["ui:button"])
  );
  expect(events("home_example_run")).toEqual([]);
  expect(utils.PgCommand.build.execute).not.toHaveBeenCalled();
});

it("reports a terminal that never mounted, and stops asking for it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    utils.PgCommand.build.execute.mockRejectedValue(UNMOUNTED);
    const { home } = draw();
    fireEvent.click(home.getByRole("button", { name: "Run it" }));
    await waitFor(() =>
      expect(events("home_example_run")).toEqual([{ outcome: "created" }])
    );
    await vi.advanceTimersByTimeAsync(15_100);
    await waitFor(() =>
      expect(
        logged.entries.map((e) => [e.ns, e.report, e.context?.waitedMs])
      ).toEqual([["home:first-run", true, 15_000]])
    );
    const calls = utils.PgCommand.build.execute.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(utils.PgCommand.build.execute).toHaveBeenCalledTimes(calls);
  } finally {
    vi.useRealTimers();
  }
});

it("tells the user when a recent project is gone since Home drew it", async () => {
  utils.PgExplorer.allWorkspaceNames = ["a", "b"];
  utils.PgExplorer.currentWorkspaceName = "a";
  const { home } = draw();
  // Deleted in another tab; the row is still drawn
  utils.PgExplorer.allWorkspaceNames = ["a"];
  fireEvent.click(home.getByRole("button", { name: "Open b" }));
  await waitFor(() =>
    expect(logged.entries.map((e) => e.ns)).toEqual(["ui:button"])
  );
  expect(utils.PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  expect(events("home_recent_opened")).toEqual([]);
});

it("offers no example before the session has been read", () => {
  session.readState = "unread";
  session.whenRead.mockReturnValue(new Promise(() => {}));
  const { home } = draw();
  expect(home.queryByRole("region", { name: "Try an example" })).toBeNull();
});

it("offers the example to a signed-in account with no projects", () => {
  session.get.mockReturnValue({
    id: "u1",
    name: "Ada",
    image: null,
    login: "ada",
  });
  const { home } = draw();
  expect(home.getByRole("region", { name: "Try an example" })).toBeTruthy();
});

it("offers no example when the session read failed", () => {
  session.readState = "failed";
  const { home } = draw();
  expect(home.queryByRole("region", { name: "Try an example" })).toBeNull();
});

it("stops waiting for the terminal once the user opens another project", async () => {
  utils.PgCommand.build.execute.mockRejectedValue(UNMOUNTED);
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: "Run it" }));
  await waitFor(() => expect(utils.PgCommand.build.execute).toHaveBeenCalled());
  // Picked in the list while the example's build waits for its terminal
  utils.PgExplorer.currentWorkspaceName = "other";
  const calls = utils.PgCommand.build.execute.mock.calls.length;
  await waitFor(() =>
    expect(logged.entries.map((e) => e.context)).toEqual([
      { reason: "left-example" },
    ])
  );
  expect(utils.PgCommand.build.execute).toHaveBeenCalledTimes(calls);
});

it("offers Try again, not the example, once a failed account check has spent its re-reads", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    session.readState = "failed";
    const { home } = draw();
    expect(home.queryByRole("region", { name: "Try an example" })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
    }
    expect(session.refresh).toHaveBeenCalledTimes(5);
    fireEvent.click(home.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(events("home_session_retried")).toEqual([{}]));
    expect(session.refresh).toHaveBeenCalledTimes(6);
    expect(home.queryByRole("region", { name: "Try an example" })).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("waits for a signed-in account's own list before offering the example", () => {
  session.get.mockReturnValue({
    id: "u1",
    name: "Ada",
    image: null,
    login: "ada",
  });
  accountList.state = "unknown";
  const { home } = draw();
  expect(home.queryByRole("region", { name: "Try an example" })).toBeNull();
});
