import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireFor } from "../../../test-utils/require-for";
import {
  PgCommandManager,
  PgCommon,
  PgExplorer,
  PgTerminal,
} from "../../../utils";
import type { FlowState, StageStatus } from "../state/stage";
import BaseConsoleDrawer, { CONSOLE_BODY_ID } from "./BaseConsoleDrawer";
import ConsoleDrawer from "./ConsoleDrawer";

// The real drawer, watched, so a test can make the request the design
// system's drawer would
vi.mock(import("./BaseConsoleDrawer"), async (load) => {
  const { CONSOLE_BODY_ID: bodyId, default: Base } = await load();
  return { CONSOLE_BODY_ID: bodyId, default: vi.fn(Base) } as const;
});

/** The props `ConsoleDrawer` last handed its Base */
const lastDrawerProps = () =>
  requireFor("a render of the Base drawer")(
    vi.mocked(BaseConsoleDrawer).mock.lastCall
  )[0];

/** Makes the request the design system's drawer would, through the
 * `onOpenChange` `ConsoleDrawer` last handed its Base */
const requestOpen = (open: boolean) =>
  act(() => lastDrawerProps().onOpenChange(open));

vi.mock("../../main/secondary/terminal/Component/Terminal", () => ({
  default: () => <div className="xterm" />,
}));

const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../shared/lib/logger", () => ({
  createLogger: () => ({ error: logError }),
}));

// The `@/utils` barrel reaches generated globals (`GLOBAL_SETTINGS`) that
// exist only in a booted app, and the drawer's imports pull it in. This
// stubs only what the drawer calls: every other `Pg*` export is undefined.
vi.mock("@/utils", () => ({
  PgTerminal: { clear: vi.fn(), setConsoleOpen: vi.fn() },
  PgCommon: { getOS: vi.fn(() => "MacOS") },
  PgExplorer: {
    onDidSwitchWorkspace: vi.fn(() => ({ dispose: () => {} })),
  },
  PgCommandManager: {
    stop: vi.fn(),
    onDidStart: vi.fn(() => ({ dispose: () => {} })),
  },
}));

/** The flow's state and its one listener, which a test drives by hand */
const flow = vi.hoisted(() => ({
  state: null as unknown,
  listener: null as ((state: unknown) => void) | null,
}));
vi.mock("../state/stage", () => ({
  PgFlow: {
    get state() {
      return flow.state;
    },
    onDidChange: (cb: (state: unknown) => void) => {
      flow.listener = cb;
      cb(flow.state);
      return { dispose: () => (flow.listener = null) };
    },
  },
}));
vi.mock("../../sidebar/assistant/bridge/build-output", () => ({
  PgBuildOutput: {
    latest: null,
    onDidChange: () => ({ dispose: () => {} }),
  },
}));

/** A flow before its first build, or with one running */
const flowState = (
  build: StageStatus,
  {
    deploy = "upcoming",
    buildStartedAt = build === "running" ? 1000 : null,
  }: { deploy?: StageStatus; buildStartedAt?: number | null } = {}
): FlowState => ({
  stage: "build",
  build,
  buildSettled: "upcoming",
  deploy,
  interact: "upcoming",
  buildErrorCount: 0,
  buildMs: null,
  buildStartedAt,
  buildStartedBefore: null,
  buildFailure: null,
  deployBeforeRun: null,
  stopped: null,
  hasProgram: true,
  sourceChanged: false,
});

/** A flow before anything ran, in a project with no program */
const noProgram = (): FlowState => {
  const state = flowState("upcoming");
  state.stage = "write";
  state.hasProgram = false;
  return state;
};

beforeEach(() => {
  flow.state = flowState("upcoming");
  flow.listener = null;
  vi.mocked(PgTerminal.clear).mockReset().mockResolvedValue(undefined);
  logError.mockReset();
});

it("should show what it is told and ask to toggle", () => {
  const onToggle = vi.fn();
  render(<ConsoleDrawer open={false} onToggle={onToggle} />);
  const handle = screen.getByRole("button", { name: "Terminal" });
  expect(handle.getAttribute("aria-expanded")).toBe("false");
  expect(
    requireFor("the console body")(
      document.getElementById(CONSOLE_BODY_ID)
    ).querySelector(".xterm")
  ).not.toBeNull();
  fireEvent.click(handle);
  expect(onToggle).toHaveBeenCalledTimes(1);
});

it("should drop the client run hint once a client run starts", () => {
  flow.state = noProgram();
  render(<ConsoleDrawer open={false} onToggle={vi.fn()} />);
  expect(
    screen.queryByText("Run the client to see its output here.")
  ).not.toBeNull();
  const call = vi.mocked(PgCommandManager.onDidStart).mock.lastCall;
  if (!call) throw new Error("The drawer did not listen for a run");
  expect(call[0]).toBe("run");
  act(() => call[1]("run"));
  expect(
    screen.queryByText("Run the client to see its output here.")
  ).toBeNull();
});

it("should bring the client run hint back when another project opens", () => {
  flow.state = noProgram();
  render(<ConsoleDrawer open={false} onToggle={vi.fn()} />);
  const started = vi.mocked(PgCommandManager.onDidStart).mock.lastCall;
  const switched = vi.mocked(PgExplorer.onDidSwitchWorkspace).mock.lastCall;
  if (!started || !switched) throw new Error("The drawer did not listen");
  act(() => started[1]("run"));
  expect(
    screen.queryByText("Run the client to see its output here.")
  ).toBeNull();
  act(() => switched[0]());
  expect(
    screen.queryByText("Run the client to see its output here.")
  ).not.toBeNull();
});

it("should report itself expanded when open", () => {
  render(<ConsoleDrawer open={true} onToggle={vi.fn()} />);
  const handle = screen.getByRole("button", { name: "Terminal" });
  expect(handle.getAttribute("aria-expanded")).toBe("true");
});

it("should tell the terminal whether it can be seen", () => {
  const { rerender, unmount } = render(
    <ConsoleDrawer open={false} onToggle={vi.fn()} />
  );
  expect(vi.mocked(PgTerminal.setConsoleOpen).mock.lastCall).toEqual([false]);
  rerender(<ConsoleDrawer open={true} onToggle={vi.fn()} />);
  expect(vi.mocked(PgTerminal.setConsoleOpen).mock.lastCall).toEqual([true]);
  unmount();
  expect(vi.mocked(PgTerminal.setConsoleOpen).mock.lastCall).toEqual([false]);
});

it("should clear the terminal from the Clear button", () => {
  render(<ConsoleDrawer open={true} onToggle={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(PgTerminal.clear).toHaveBeenCalledTimes(1);
});

it("should report a clear that fails", async () => {
  const failure = new Error("boom");
  vi.mocked(PgTerminal.clear).mockRejectedValueOnce(failure);
  render(<ConsoleDrawer open={true} onToggle={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  await vi.waitFor(() => expect(logError).toHaveBeenCalledTimes(1));
  expect(logError.mock.calls[0][0]).toBe(failure);
  expect(logError.mock.calls[0][1].report).toBe(true);
});

it("should toggle on a request for the other state only", () => {
  const onToggle = vi.fn();
  const { rerender } = render(
    <ConsoleDrawer open={false} onToggle={onToggle} />
  );
  requestOpen(false);
  expect(onToggle).not.toHaveBeenCalled();
  requestOpen(true);
  expect(onToggle).toHaveBeenCalledTimes(1);

  rerender(<ConsoleDrawer open={true} onToggle={onToggle} />);
  requestOpen(true);
  expect(onToggle).toHaveBeenCalledTimes(1);
  requestOpen(false);
  expect(onToggle).toHaveBeenCalledTimes(2);
});

it("should show the flow's status as it changes", () => {
  render(<ConsoleDrawer open={false} onToggle={vi.fn()} />);
  expect(screen.queryByText(/Building/)).toBeNull();

  act(() =>
    requireFor("the flow listener ConsoleDrawer subscribed")(flow.listener)(
      flowState("running")
    )
  );

  expect(screen.getByText(/^Building…/)).toBeTruthy();
});

it("should stop the run in flight from Stop", () => {
  flow.state = flowState("running");
  render(<ConsoleDrawer open={false} onToggle={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "Stop build" }));

  expect(PgCommandManager.stop).toHaveBeenCalledTimes(1);
});

describe("the strip's clock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("should count a build from its own start, as the slow line does", () => {
    render(<ConsoleDrawer open={false} onToggle={vi.fn()} />);
    // Mounted 5 s into the run, as after a remount
    act(() =>
      requireFor("the flow listener ConsoleDrawer subscribed")(flow.listener)(
        flowState("running", { buildStartedAt: Date.now() - 5_000 })
      )
    );
    expect(screen.getByText("Building… \u00b7 5 s")).toBeTruthy();

    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByText("Building… \u00b7 8 s")).toBeTruthy();
  });

  it("should count a deploy from when the strip saw it start", () => {
    render(<ConsoleDrawer open={false} onToggle={vi.fn()} />);
    act(() =>
      requireFor("the flow listener ConsoleDrawer subscribed")(flow.listener)(
        flowState("done", { deploy: "running" })
      )
    );
    act(() => vi.advanceTimersByTime(2_000));

    expect(screen.getByText("Deploying… \u00b7 2 s")).toBeTruthy();
  });

  it("should stop counting once the run is over", () => {
    render(<ConsoleDrawer open={false} onToggle={vi.fn()} />);
    act(() =>
      requireFor("the flow listener ConsoleDrawer subscribed")(flow.listener)(
        flowState("done", { deploy: "running" })
      )
    );
    act(() =>
      requireFor("the flow listener ConsoleDrawer subscribed")(flow.listener)(
        flowState("done", { deploy: "done" })
      )
    );

    expect(screen.getByText("Deployed")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it.each([
  ["MacOS", "⌘J"],
  ["Windows", "Ctrl+J"],
  ["Linux", "Ctrl+J"],
] as const)("shows the toggle's key on %s as %s", (os, key) => {
  vi.mocked(PgCommon.getOS).mockReturnValue(os);
  render(<ConsoleDrawer open={false} onToggle={vi.fn()} />);
  expect(lastDrawerProps().shortcut).toBe(key);
});
