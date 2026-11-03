// The Interact container names the network as a sentence writes it.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surface: "ready" as string,
  cluster: "devnet" as string | null,
  noop: () => ({ dispose: () => undefined }),
}));

vi.mock("./interact-surface", () => ({
  interactFacts: () => ({}),
  interactSurface: () => mocks.surface,
}));
vi.mock("./IdlActions", () => ({ default: () => null }));
vi.mock("./InteractBody", () => ({ default: () => null }));
vi.mock("../../sidebar/assistant/bridge/build-output", () => ({
  PgBuildOutput: { latest: null, onDidChange: mocks.noop },
}));
vi.mock("../../../components/Wallet/hooks/useAirdrop", () => ({
  useAirdrop: () => ({ airdrop: vi.fn(), faucet: "available" }),
}));
vi.mock("../../../utils", () => ({
  PgConnection: {
    get cluster() {
      return mocks.cluster;
    },
    onDidChangeCluster: mocks.noop,
  },
  PgExplorer: {
    currentWorkspaceName: "hello",
    onDidSwitchWorkspace: mocks.noop,
  },
  PgProgramInfo: {
    callableIdl: () => null,
    getPkStr: () => "6PNd3SmUcvQEHfcTiQkpprF4mmXzR7Ez7JwJfnJDAVkj",
    readIdl: () => null,
    update: vi.fn(),
  },
  PgWeb3: {},
}));
vi.mock("../../../hooks", () => ({
  useBalance: () => 0,
  useExplorer: () => ({}),
  useProgramInfo: () => ({}),
  useRenderOnChange: () => undefined,
  useWallet: () => ({ isPg: true }),
}));
vi.mock("../state/stage", () => ({ PgFlow: { setStage: vi.fn() } }));
vi.mock("../state/deploy-history", () => ({
  PgDeployHistory: { list: () => [], onDidChange: mocks.noop },
}));

import Interact from "./Interact";
import { TooltipProvider } from "@/shared/ui/tooltip";

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
