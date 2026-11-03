import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { FC } from "react";
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
  PgTutorial: { all: [] as unknown[], open: vi.fn() },
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
  PgFramework: {
    all: [] as { name: string; defaultOpenFile?: string }[],
    get: vi.fn(),
  },
  PgCommand: { build: { execute: vi.fn() } },
  PgGlobal: { buildLoading: false },
  isTerminalUnmounted: () => false,
}));
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
import PhoneHome from "./PhoneHome";

const files = [["/src/lib.rs", "// anchor"]];
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
    { name: "Intro", level: "Intermediate" },
    { name: "Hello Anchor", level: "Beginner" },
    { name: "Another", level: "Beginner" },
  ];
  utils.PgTutorial.open.mockReset().mockResolvedValue(undefined);
  utils.PgView.setModal.mockReset().mockResolvedValue(null);
  utils.PgView.setToast.mockReset();
  utils.PgCommon.fetchJSON.mockReset().mockResolvedValue(LISTING);
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
  utils.PgFramework.all = [{ name: "Native" }, { name: "Anchor" }];
  utils.PgCommand.build.execute.mockReset().mockResolvedValue(undefined);
  session.get.mockReset().mockReturnValue(null);
  session.readState = "answered";
  accountList.state = "empty";
  session.refresh.mockReset().mockResolvedValue(undefined);
  session.whenRead.mockReset().mockResolvedValue(undefined);
  utils.PgFramework.get.mockReset().mockReturnValue({
    defaultOpenFile: "/src/lib.rs",
    getDefaultFiles: async () => ({ files }),
  });
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
  const onContinue = vi.fn();
  const onOpenPage = vi.fn();
  render(
    <PhoneHome onAsk={onAsk} onContinue={onContinue} onOpenPage={onOpenPage} />
  );
  return {
    home: within(screen.getByRole("region", { name: "Home" })),
    onAsk,
    onContinue,
    onOpenPage,
  };
};
const titles = (home: ReturnType<typeof draw>["home"]) =>
  within(home.getByRole("navigation", { name: "Quick start" }))
    .getAllByRole("button")
    .map((b) => b.textContent);
const events = (name: string) =>
  sent.events.filter((e) => e.name === name).map((e) => e.params);

it("leads with the example on a first visit, then a new Anchor project and the first beginner tutorial", async () => {
  const { home } = draw();
  await home.findByText("3 tutorials, 34 programs");
  expect(titles(home)).toEqual([
    "Try an exampleThe Anchor starter, built for you",
    "New Anchor projectA working starter you shape with the assistant",
    "Hello AnchorBeginner tutorial",
  ]);
});

it("makes the example and builds it once from its quick start", async () => {
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: /Try an example/ }));
  await waitFor(() =>
    expect(events("home_quickstart_opened")).toEqual([{ id: "example" }])
  );
  expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith(
    "anchor-example",
    { files, defaultOpenFile: "/src/lib.rs" }
  );
  expect(utils.PgCommand.build.execute).toHaveBeenCalledTimes(1);
  expect(events("home_example_run")).toEqual([{ outcome: "created" }]);
});

it("offers no example once the browser holds a project", async () => {
  utils.PgExplorer.allWorkspaceNames = ["counter"];
  const { home } = draw();
  await home.findByText("3 tutorials, 34 programs");
  expect(titles(home).some((t) => t?.startsWith("Try an example"))).toBe(false);
});

it("puts Continue first when a project is open and goes back to it without a switch", async () => {
  utils.PgExplorer.currentWorkspaceName = "counter";
  utils.PgExplorer.allWorkspaceNames = ["counter"];
  const { home, onContinue } = draw();
  expect(titles(home)[0]).toBe("Continue counterYour last project");
  fireEvent.click(home.getByRole("button", { name: /Continue counter/ }));
  await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1));
  expect(utils.PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(events("home_quickstart_opened")).toEqual([{ id: "continue" }])
  );
});

it("creates anchor-project from the Anchor defaults and reports it", async () => {
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: /New Anchor project/ }));
  await waitFor(() =>
    expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith(
      "anchor-project",
      { files, defaultOpenFile: "/src/lib.rs" }
    )
  );
  expect(utils.PgFramework.get).toHaveBeenCalledWith("Anchor");
  await waitFor(() =>
    expect(events("home_quickstart_opened")).toEqual([{ id: "new" }])
  );
});

it("numbers the project when the name is taken", async () => {
  utils.PgExplorer.allWorkspaceNames = ["anchor-project"];
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: /New Anchor project/ }));
  await waitFor(() =>
    expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith(
      "anchor-project-2",
      { files, defaultOpenFile: "/src/lib.rs" }
    )
  );
});

it("opens the tutorial by name", async () => {
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: /Hello Anchor/ }));
  await waitFor(() =>
    expect(utils.PgTutorial.open).toHaveBeenCalledWith("Hello Anchor")
  );
  await waitFor(() =>
    expect(events("home_quickstart_opened")).toEqual([{ id: "tutorial" }])
  );
});

it("logs a failed action once, toasts it and frees the button", async () => {
  const failure = new Error("no such tutorial");
  utils.PgTutorial.open.mockRejectedValueOnce(failure);
  const { home } = draw();
  const button = home.getByRole("button", { name: /Hello Anchor/ });
  fireEvent.click(button);
  await waitFor(() => expect(utils.PgView.setToast).toHaveBeenCalledTimes(1));
  expect(utils.PgView.setToast.mock.calls[0][1]).toEqual({
    options: { name: "home-action-failed" },
  });
  expect(logged.entries).toHaveLength(1);
  expect(logged.entries[0].ns).toBe("home:actions");
  expect(logged.entries[0].report).toBe(true);
  expect(logged.entries[0].error).toBe(failure);
  expect(events("home_quickstart_opened")).toEqual([]);
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false)
  );
});

/** The text the failure toast shows: its component, drawn alone */
const toastText = () => {
  const [Toast] = utils.PgView.setToast.mock.calls[0] as [FC];
  return render(<Toast />).container.textContent;
};

it("toasts a project gone since Home drew it, and does not report it opened", async () => {
  utils.PgExplorer.currentWorkspaceName = "counter";
  utils.PgExplorer.allWorkspaceNames = ["counter"];
  const { home, onContinue } = draw();
  // Deleted in another tab before the tap
  utils.PgExplorer.allWorkspaceNames = [];
  fireEvent.click(home.getByRole("button", { name: /Continue counter/ }));
  await waitFor(() => expect(utils.PgView.setToast).toHaveBeenCalledTimes(1));
  expect(utils.PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  expect(onContinue).not.toHaveBeenCalled();
  expect(logged.entries).toHaveLength(1);
  expect(logged.entries[0].report).toBe(true);
  expect(events("home_quickstart_opened")).toEqual([]);
});

it("toasts the message of a failure that is not an Error", async () => {
  utils.PgTutorial.open.mockRejectedValueOnce({ message: "quota exceeded" });
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: /Hello Anchor/ }));
  await waitFor(() => expect(utils.PgView.setToast).toHaveBeenCalledTimes(1));
  expect(toastText()).toBe("Could not open. quota exceeded");
});

it("opens the Tutorials page from Browse, and no gallery", async () => {
  const { home, onOpenPage } = draw();
  fireEvent.click(home.getByRole("button", { name: "Browse" }));
  expect(onOpenPage).toHaveBeenCalledWith("tutorials");
  expect(utils.PgView.setModal).not.toHaveBeenCalled();
  // The program count lands after the listing's fetch, past the last assertion
  await home.findByText("3 tutorials, 34 programs");
});

it("opens the assistant from the composer and reports it", async () => {
  const { home, onAsk } = draw();
  fireEvent.click(home.getByRole("button", { name: "Ask the assistant" }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(events("home_composer_opened")).toEqual([{}]);
  await home.findByText("3 tutorials, 34 programs");
});

it("switches to the project Continue names when another opened since Home drew it", async () => {
  utils.PgExplorer.currentWorkspaceName = "counter";
  utils.PgExplorer.allWorkspaceNames = ["counter", "escrow"];
  const { home, onContinue } = draw();
  // Another tab opened escrow before the tap
  utils.PgExplorer.currentWorkspaceName = "escrow";
  fireEvent.click(home.getByRole("button", { name: /Continue counter/ }));
  await waitFor(() =>
    expect(utils.PgExplorer.switchWorkspace).toHaveBeenCalledWith("counter")
  );
  expect(onContinue).not.toHaveBeenCalled();
});

it.each([
  ["the session is unread", () => (session.readState = "unread")],
  ["the session read failed", () => (session.readState = "failed")],
])("offers no example quick start while %s", async (_, set) => {
  set();
  session.whenRead.mockReturnValue(new Promise(() => {}));
  const { home } = draw();
  await home.findByText("3 tutorials, 34 programs");
  expect(titles(home)[0]).toBe(
    "New Anchor projectA working starter you shape with the assistant"
  );
});

it("offers the example to a signed-in account with no projects", async () => {
  session.get.mockReturnValue({
    id: "u1",
    name: "Ada",
    image: null,
    login: "ada",
  });
  const { home } = draw();
  await home.findByText("3 tutorials, 34 programs");
  expect(titles(home)[0]).toBe(
    "Try an exampleThe Anchor starter, built for you"
  );
});

it("opens the example another tab made since Home drew it, and builds nothing", async () => {
  const { home } = draw();
  utils.PgExplorer.allWorkspaceNames = ["anchor-example"];
  fireEvent.click(home.getByRole("button", { name: /Try an example/ }));
  await waitFor(() =>
    expect(events("home_example_run")).toEqual([{ outcome: "opened" }])
  );
  expect(utils.PgExplorer.switchWorkspace).toHaveBeenCalledWith(
    "anchor-example"
  );
  expect(utils.PgExplorer.createWorkspace).not.toHaveBeenCalled();
  expect(utils.PgCommand.build.execute).not.toHaveBeenCalled();
  expect(events("home_quickstart_opened")).toEqual([{ id: "example" }]);
});

it("goes back to the example when it is already open", async () => {
  const { home, onContinue } = draw();
  utils.PgExplorer.allWorkspaceNames = ["anchor-example"];
  utils.PgExplorer.currentWorkspaceName = "anchor-example";
  fireEvent.click(home.getByRole("button", { name: /Try an example/ }));
  await waitFor(() =>
    expect(events("home_example_run")).toEqual([{ outcome: "current" }])
  );
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(utils.PgExplorer.switchWorkspace).not.toHaveBeenCalled();
});

it("toasts an example that cannot be made, and counts nothing", async () => {
  utils.PgExplorer.createWorkspace.mockRejectedValueOnce(new Error("quota"));
  const { home } = draw();
  fireEvent.click(home.getByRole("button", { name: /Try an example/ }));
  await waitFor(() => expect(utils.PgView.setToast).toHaveBeenCalled());
  expect(logged.entries.map((e) => [e.ns, e.report])).toEqual([
    ["home:actions", true],
  ]);
  expect(events("home_example_run")).toEqual([]);
  expect(events("home_quickstart_opened")).toEqual([]);
  expect(utils.PgCommand.build.execute).not.toHaveBeenCalled();
});

it("offers Try again above the quick starts once a failed check has spent its re-reads", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    session.readState = "failed";
    const { home } = draw();
    await home.findByText("3 tutorials, 34 programs");
    expect(titles(home)[0]).toBe(
      "New Anchor projectA working starter you shape with the assistant"
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
    }
    fireEvent.click(home.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(events("home_session_retried")).toEqual([{}]));
    expect(titles(home).some((t) => t?.startsWith("Try an example"))).toBe(
      false
    );
  } finally {
    vi.useRealTimers();
  }
});

it("offers no example quick start while a signed-in account's list is unread", async () => {
  session.get.mockReturnValue({
    id: "u1",
    name: "Ada",
    image: null,
    login: "ada",
  });
  accountList.state = "unknown";
  const { home } = draw();
  await home.findByText("3 tutorials, 34 programs");
  expect(titles(home).some((t) => t?.startsWith("Try an example"))).toBe(false);
});
