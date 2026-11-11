// The Interact container names the network as a sentence writes it.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surface: "ready" as string,
  cluster: "devnet" as string | undefined,
  noop: () => ({ dispose: () => undefined }),
  history: [] as { id: string; programId: string; cluster: string }[],
  customPk: "the user's custom id" as string | undefined,
  workspaceId: "w1",
  update: vi.fn(),
  // eslint-disable-next-line unicorn/no-null -- `callableIdl()` answers `null` with no IDL
  callable: null as object | null,
}));

vi.mock("./interact-surface", () => ({
  interactFacts: () => ({}),
  interactSurface: () => mocks.surface,
}));
vi.mock("./IdlActions", () => ({
  default: () => undefined,
  loadIdlFile: async () => true,
  openInteract: () => undefined,
}));
// Echoes the network it is told the wallet lacks SOL on
vi.mock("./InteractBody", () => ({
  default: ({ solNeededOn }: { solNeededOn?: string }) => (
    <span data-testid="interact-body">{solNeededOn ?? "none"}</span>
  ),
}));
vi.mock("../../sidebar/assistant/bridge/build-output", () => ({
  // eslint-disable-next-line unicorn/no-null -- `PgBuildOutput.latest` is `null` before any build
  PgBuildOutput: { latest: null, onDidChange: mocks.noop },
}));
vi.mock("../../../components/Wallet/hooks/useAirdrop", () => ({
  useAirdrop: () => ({ airdrop: vi.fn(), faucet: "available" }),
}));
vi.mock("../../../utils", async () => {
  const { PROGRAM_ID } = await import("../__fixtures__/addresses");
  return {
    PgConnection: {
      get cluster() {
        return mocks.cluster;
      },
      onDidChangeCluster: mocks.noop,
    },
    PgExplorer: {
      currentWorkspaceName: "hello",
      get currentWorkspaceId() {
        return mocks.workspaceId;
      },
      onDidSwitchWorkspace: mocks.noop,
    },
    PgProgramInfo: {
      get customPk() {
        return mocks.customPk;
      },
      callableIdl: () => mocks.callable,
      getPkStr: () => PROGRAM_ID,
      // eslint-disable-next-line unicorn/no-null -- `readIdl()` answers `null` with no IDL
      readIdl: () => null,
      update: mocks.update,
    },
    PgWeb3: {
      PublicKey: class {
        constructor(readonly id: string) {}
      },
    },
  };
});
vi.mock("../../../hooks", () => ({
  useBalance: () => 0,
  useExplorer: () => ({}),
  useProgramInfo: () => ({}),
  useRenderOnChange: () => undefined,
  useWallet: () => ({ isPg: true }),
}));
vi.mock("../state/stage", () => ({ PgFlow: { setStage: vi.fn() } }));
vi.mock("../state/deploy-history", () => ({
  PgDeployHistory: {
    list: () => mocks.history,
    onDidChange: (listener: () => void) => {
      listener();
      return mocks.noop();
    },
  },
}));

import { TooltipProvider } from "@/shared/ui/tooltip";

import Interact from "./Interact";

const renderInteract = () =>
  render(
    <TooltipProvider>
      <Interact />
    </TooltipProvider>
  );

describe("Interact", () => {
  beforeEach(() => {
    mocks.surface = "ready";
    mocks.cluster = "devnet";
    mocks.history = [];
    mocks.workspaceId = "w1";
    mocks.update.mockClear();
    // eslint-disable-next-line unicorn/no-null -- `callableIdl()` answers `null` with no IDL
    mocks.callable = null;
  });

  it("tells the form which network the wallet lacks SOL on", () => {
    mocks.callable = { instructions: [] };
    renderInteract();
    expect(screen.getByTestId("interact-body").textContent).toBe("devnet");
  });

  const pickADeployment = () => {
    mocks.history = [
      { id: "old", programId: "old-program", cluster: "devnet" },
      { id: "older", programId: "older-program", cluster: "devnet" },
    ];
    const view = renderInteract();
    fireEvent.change(screen.getByLabelText("Deployment"), {
      target: { value: "older" },
    });
    return view;
  };

  it("hands back the custom id the user set when leaving after a pick", () => {
    const { unmount } = pickADeployment();
    expect(mocks.update).toHaveBeenCalledTimes(1);

    unmount();

    expect(mocks.update).toHaveBeenLastCalledWith({
      customPk: "the user's custom id",
    });
  });

  it("leaves the target alone when no deployment was picked", () => {
    renderInteract().unmount();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not write one project's custom id into another", () => {
    const { unmount } = pickADeployment();
    mocks.workspaceId = "w2";

    unmount();

    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("asks for devnet SOL, lowercase, when the wallet cannot pay a fee", () => {
    renderInteract();
    expect(
      screen.getByText(
        "This call needs a small fee in devnet SOL. Your wallet has 0 SOL."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Get devnet SOL" })).toBeTruthy();
  });

  it("names the network lowercase while it reads the program", () => {
    mocks.surface = "checking";
    renderInteract();
    expect(
      screen.getByText(
        "Reading the program from devnet to see whether it is deployed."
      )
    ).toBeTruthy();
  });
});
