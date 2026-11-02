// The Deploy stage's brand button: a deploy that fails is reported, and a
// deploy under way cannot be started again.
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  report: vi.fn(),
  markShown: vi.fn(),
  flow: { build: "done", deploy: "active" },
  deployState: "ready",
  history: [] as unknown[],
  update: vi.fn(),
  noop: () => ({ dispose: () => undefined }),
}));

// The real barrels pull in the whole playground; the stage reads only these
vi.mock("../../../utils", () => ({
  PgCommand: { deploy: { execute: mocks.execute } },
  PgConnection: { cluster: "devnet", onDidChangeCluster: "cluster" },
  PgExplorer: {
    currentWorkspaceName: "counter",
    onDidSwitchWorkspace: mocks.noop,
  },
  PgGlobal: { onDidChangeDeployState: "deployState" },
  PgProgramInfo: { update: mocks.update },
}));
vi.mock("../../../hooks", () => ({
  useBlockExplorer: () => ({
    getAddressUrl: (id: string) => `https://explorer.test/address/${id}`,
    getTxUrl: (sig: string) => `https://explorer.test/tx/${sig}`,
  }),
  useProgramInfo: () => ({ onChain: null, pk: null }),
  useRenderOnChange: (event: string) =>
    event === "deployState" ? mocks.deployState : undefined,
}));
vi.mock("../state/stage", () => ({
  PgFlow: {
    get state() {
      return mocks.flow;
    },
    onDidChange: mocks.noop,
  },
}));
vi.mock("../state/deploy-history", () => ({
  PgDeployHistory: { list: () => mocks.history, onDidChange: mocks.noop },
}));
vi.mock("./IdlActions", () => ({ default: () => null }));
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: (action: string) =>
    action === "deploy" ? mocks.report : vi.fn(),
  markFailureShown: mocks.markShown,
}));

import { TooltipProvider } from "@/shared/ui/tooltip";
import Deploy from "./Deploy";

/** The app gives every screen a tooltip provider; the copy button needs one */
const render = (ui: ReactElement) =>
  rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

afterEach(() => {
  mocks.flow = { build: "done", deploy: "active" };
  mocks.deployState = "ready";
  mocks.history = [];
  vi.clearAllMocks();
});

describe("Deploy stage", () => {
  it("reports a deploy that fails", async () => {
    const failure = new Error("insufficient balance");
    mocks.execute.mockRejectedValue(failure);
    render(<Deploy />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }))
    );

    expect(mocks.report).toHaveBeenCalledWith(failure);
  });

  // The stage's Callout says it failed; a toast would say it twice
  it("marks a failed deploy as shown by the stage", async () => {
    const failure = new Error("insufficient balance");
    mocks.execute.mockImplementation(async () => {
      mocks.flow = { build: "done", deploy: "failed" };
      throw failure;
    });
    render(<Deploy />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }))
    );

    expect(mocks.markShown).toHaveBeenCalledWith(failure);
  });

  it("leaves a deploy that never started to the toast", async () => {
    const failure = new Error("no terminal");
    mocks.execute.mockRejectedValue(failure);
    render(<Deploy />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }))
    );

    expect(mocks.markShown).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(failure);
  });

  it("holds the button while a deploy is under way", () => {
    mocks.deployState = "loading";
    render(<Deploy />);

    const button = screen.getByRole("button", { name: "Deploying..." });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  /** The stage remounts on every switch; nothing fires to fill it again */
  it("shows a deployment made before the stage opened", () => {
    mocks.history = [
      {
        id: "a",
        workspace: "counter",
        cluster: "devnet",
        programId: "Prog111",
        signature: null,
        at: 1,
      },
    ];
    render(<Deploy />);

    expect(screen.getByRole("status").textContent).toContain(
      "Deployed to devnet"
    );
    expect(
      screen.getByRole("button", { name: "Redeploy to devnet" })
    ).toBeTruthy();
  });

  /** Interact may have pointed the project at an imported id */
  it("redeploys the project's own key", async () => {
    mocks.execute.mockResolvedValue(undefined);
    render(<Deploy />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }))
    );

    expect(mocks.update).toHaveBeenCalledWith({ customPk: null });
    expect(mocks.execute).toHaveBeenCalled();
  });
});
