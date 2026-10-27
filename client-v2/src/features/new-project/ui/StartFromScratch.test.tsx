// Start: one project per press, closes the dialog, and stays usable after a
// failure that has nothing to do with the name.
import { act, fireEvent, render, screen } from "@testing-library/react";
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
  getDefaultFiles: vi.fn(),
  PgExplorer: {
    isWorkspaceNameValid: (name: string) => !name.includes("("),
    createWorkspace: vi.fn(),
  },
  PgFramework: {
    all: [
      { name: "Anchor", icon: "/anchor.png", circleImage: false },
      { name: "Native", icon: "/native.png", circleImage: true },
    ],
    get: vi.fn(),
  },
  PgView: { setModal: vi.fn() },
}));
vi.mock("@/utils", () => utils);

import StartFromScratch from "./StartFromScratch";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  utils.getDefaultFiles.mockReset().mockResolvedValue({ files: [["a", "b"]] });
  utils.PgFramework.get.mockReset().mockReturnValue({
    getDefaultFiles: utils.getDefaultFiles,
    defaultOpenFile: "src/lib.rs",
  });
  utils.PgExplorer.createWorkspace.mockReset().mockResolvedValue(undefined);
  utils.PgView.setModal.mockReset();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetTelemetry();
  resetLogger();
});

const named = (name: string) => sent.events.filter((e) => e.name === name);
const start = () => screen.getByRole("button", { name: /^Start/ });
const nameField = () => screen.getByLabelText("Project name");

it("makes the project from the framework's starter and says so", async () => {
  const onStarted = vi.fn();
  render(<StartFromScratch onStarted={onStarted} />);
  fireEvent.change(nameField(), { target: { value: "vault" } });

  await act(async () => fireEvent.click(start()));

  expect(utils.PgFramework.get).toHaveBeenCalledWith("Anchor");
  expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith("vault", {
    files: [["a", "b"]],
    defaultOpenFile: "src/lib.rs",
  });
  expect(onStarted).toHaveBeenCalledTimes(1);
  expect(named("new_project_started").map((e) => e.params)).toEqual([
    { framework: "Anchor" },
  ]);
});

it("names an unnamed project after its framework", async () => {
  render(<StartFromScratch />);
  fireEvent.click(screen.getByRole("radio", { name: /Native/ }));

  await act(async () => fireEvent.click(start()));

  expect(utils.PgExplorer.createWorkspace.mock.calls[0][0]).toBe(
    "native-project"
  );
});

it("refuses an invalid name and makes nothing until it is edited", async () => {
  render(<StartFromScratch />);
  fireEvent.change(nameField(), { target: { value: "a (b)" } });

  await act(async () => fireEvent.click(start()));

  expect(screen.getByRole("alert").textContent).toBe("Invalid project name");
  expect(start()).toHaveProperty("disabled", true);
  expect(utils.PgExplorer.createWorkspace).not.toHaveBeenCalled();
  expect(named("new_project_start_failed")).toEqual([]);

  fireEvent.change(nameField(), { target: { value: "ab" } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(start()).toHaveProperty("disabled", false);
});

it("makes one project for a double press", async () => {
  let release!: () => void;
  utils.getDefaultFiles.mockReturnValue(
    new Promise((resolve) => (release = () => resolve({ files: [] })))
  );
  render(<StartFromScratch />);

  fireEvent.click(start());
  fireEvent.click(start());
  expect(start().getAttribute("aria-busy")).toBe("true");

  await act(async () => release());

  expect(utils.getDefaultFiles).toHaveBeenCalledTimes(1);
  expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledTimes(1);
});

it("makes one project when Enter is pressed while one is being made", async () => {
  let release!: () => void;
  utils.getDefaultFiles.mockReturnValue(
    new Promise((resolve) => (release = () => resolve({ files: [] })))
  );
  render(<StartFromScratch />);

  fireEvent.keyDown(nameField(), { key: "Enter" });
  fireEvent.keyDown(nameField(), { key: "Enter" });
  await act(async () => release());

  expect(utils.getDefaultFiles).toHaveBeenCalledTimes(1);
  expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledTimes(1);
});

it("closes no dialog of its own: Home has none to close", async () => {
  render(<StartFromScratch />);

  await act(async () => fireEvent.click(start()));

  expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledTimes(1);
  expect(utils.PgView.setModal).not.toHaveBeenCalled();
});

it("does not call a made project a failure when what follows it throws", async () => {
  const onStarted = vi.fn(() => {
    throw new Error("closing failed");
  });
  render(<StartFromScratch onStarted={onStarted} />);

  await act(async () => {
    expect(() => fireEvent.click(start())).not.toThrow();
  });

  expect(named("new_project_started")).toHaveLength(1);
  expect(named("new_project_start_failed")).toEqual([]);
  expect(screen.queryByText("closing failed")).toBeNull();
  expect(logged.entries.map((e) => [e.ns, e.report])).toEqual([
    ["new-project:start", true],
  ]);
});

it("shows a failed start, reports it and accepts a retry", async () => {
  utils.PgExplorer.createWorkspace.mockRejectedValueOnce(
    new Error("Workspace already exists")
  );
  render(<StartFromScratch />);

  await act(async () => fireEvent.click(start()));

  expect(screen.getByRole("alert").textContent).toBe(
    "Workspace already exists"
  );
  expect(utils.PgView.setModal).not.toHaveBeenCalled();
  expect(named("new_project_start_failed").map((e) => e.params)).toEqual([
    { framework: "Anchor" },
  ]);
  expect(logged.entries.map((e) => [e.ns, e.report])).toEqual([
    ["new-project:start", true],
  ]);
  expect(start()).toHaveProperty("disabled", false);

  await act(async () => fireEvent.click(start()));

  expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledTimes(2);
  expect(named("new_project_started")).toHaveLength(1);
});
