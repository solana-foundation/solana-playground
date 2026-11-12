// The Deploy stage's brand button: a deploy that fails is reported, and a
// deploy under way cannot be started again.
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NETWORKS } from "@/constants";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  report: vi.fn(),
  markShown: vi.fn(),
  markUnavailable: vi.fn(),
  flow: { build: "done", deploy: "active" },
  // eslint-disable-next-line unicorn/no-null -- `useProgramInfo()` answers `null` for a failed chain read, no keypair and no build
  programInfo: { onChain: null, pk: null, uuid: null as string | null },
  deployState: "ready",
  hold: undefined as string | undefined,
  history: [] as unknown[],
  update: vi.fn(),
  setStage: vi.fn(),
  requestConsole: vi.fn(),
  pickNetwork: vi.fn(),
  noop: () => ({ dispose: () => undefined }),
  wallet: {
    // eslint-disable-next-line unicorn/no-null -- `PgWallet.current` is `null` while no wallet is current
    current: null as null | {
      isPg: boolean;
      publicKey: { toBase58: () => string };
    },
    accounts: [] as unknown[],
    currentIndex: -1,
    // The Fund dialog's receiver when no Playground wallet is current
    create: vi.fn(() => ({ publicKey: { toBase58: () => "F1rstAccount" } })),
    add: vi.fn(),
    switch: vi.fn(),
    export: vi.fn(),
    onDidChangeCurrent: vi.fn((cb: (w: unknown) => void) => {
      mocks.walletListeners.add(cb);
      cb(mocks.wallet.current);
      return { dispose: () => mocks.walletListeners.delete(cb) };
    }),
  },
  walletListeners: new Set<(w: unknown) => void>(),
  signIn: vi.fn(),
  signInFor: vi.fn(),
  automaticAirdrop: false,
  /** The network the deploy's endpoint answers for, read before any send */
  endpointCluster: "devnet",
  /** Runs while the network is read, as a user acting during a slow read */
  duringNetworkRead: undefined as (() => void) | undefined,
}));

// The real barrels pull in the whole playground; the stage reads only these
vi.mock("../../../utils", () => ({
  PgCommand: { deploy: { execute: mocks.execute } },
  PgConnection: { cluster: "devnet", onDidChangeCluster: "cluster" },
  PgExplorer: {
    currentWorkspaceName: "counter",
    onDidSaveFile: mocks.noop,
    onDidSwitchWorkspace: mocks.noop,
  },
  PgFramework: { getFromFiles: async () => undefined },
  PgGlobal: {
    onDidChangeDeployState: "deployState",
    get deployState() {
      return mocks.deployState;
    },
  },
  PgProgramInfo: { update: mocks.update },
  PgSettings: {
    connection: { endpoint: "https://api.devnet.solana.com" },
    wallet: {
      get automaticAirdrop() {
        return mocks.automaticAirdrop;
      },
    },
  },
  PgWallet: mocks.wallet,
}));
// The real check reads the endpoint's genesis hash; here the endpoint
// answers for `mocks.endpointCluster`
vi.mock("@/commands/deploy/check-not-mainnet", async () => {
  const { MainnetDeployRefusedError } = await import(
    "@/commands/deploy/mainnet-block"
  );
  return {
    checkNotMainnet: async () => {
      mocks.duringNetworkRead?.();
      if (mocks.endpointCluster === "mainnet-beta") {
        throw new MainnetDeployRefusedError();
      }
      if (mocks.endpointCluster === "unread") {
        throw new Error("Could not read which network the endpoint serves");
      }
    },
  };
});
vi.mock("@/features/auth", () => ({
  PgSession: { signInFor: mocks.signInFor },
  isSignInFailure: () => false,
}));
vi.mock("../../../hooks", () => ({
  useBlockExplorer: () => ({
    getAddressUrl: (id: string) => `https://explorer.test/address/${id}`,
    getTxUrl: (sig: string) => `https://explorer.test/tx/${sig}`,
    opens: () => true,
  }),
  useProgramInfo: () => mocks.programInfo,
  useWallet: () => mocks.wallet.current,
  useBalance: () => 4.2,
  useRenderOnChange: (event: string) =>
    event === "deployState" ? mocks.deployState : undefined,
}));
vi.mock("../state/stage", () => ({
  PgFlow: {
    get state() {
      return mocks.flow;
    },
    onDidChange: mocks.noop,
    setStage: mocks.setStage,
  },
}));
vi.mock("@/widgets/layout-shell", () => ({
  requestConsole: mocks.requestConsole,
}));
vi.mock("../state/deploy-history", () => ({
  PgDeployHistory: { list: () => mocks.history, onDidChange: mocks.noop },
}));
vi.mock("@/widgets/status", () => ({ useNetworkHold: () => mocks.hold }));
// The real pick refuses while a deploy or an `anchor idl` write holds the
// network (pick-network.test.ts); the stage only hands it the URL
vi.mock("@/widgets/settings-page", () => ({ pickNetwork: mocks.pickNetwork }));
vi.mock("./IdlActions", () => ({
  default: () => null,
  useIdlName: () => undefined,
  loadIdlFile: async () => true,
  openInteract: () => undefined,
}));
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: (action: string) =>
    action === "deploy" ? mocks.report : vi.fn(),
  markFailureShown: mocks.markShown,
  markUnavailableHere: mocks.markUnavailable,
}));

import { PgStageDeploy } from "@/features/deploy";
import { onDidRequestFundDialog } from "@/features/fund-wallet";
import { TooltipProvider } from "@/shared/ui/tooltip";

import {
  MAINNET_DEPLOY_BLOCKED,
  MAINNET_DEPLOY_WAY_OUT,
} from "../../../commands/deploy/mainnet-block";
import {
  DeployCancelledError,
  DeployFundingError,
  PgDeployRun,
} from "../../../commands/deploy/run";
import { FRESH_WALLET, WALLET } from "../__fixtures__/addresses";
import Deploy from "./Deploy";

const pgWallet = () => ({ isPg: true, publicKey: { toBase58: () => WALLET } });

/** The app gives every screen a tooltip provider; the copy button needs one */
const render = (ui: ReactElement) =>
  rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

let sent: ReturnType<typeof memoryProvider>;
/** The wallet `add` creates becomes current, and its listeners hear it */
const becomeCurrent = () => {
  mocks.wallet.current = pgWallet();
  for (const cb of mocks.walletListeners) cb(mocks.wallet.current);
};

beforeEach(() => {
  mocks.wallet.add.mockImplementation(becomeCurrent);
  mocks.signInFor.mockReturnValue(mocks.signIn);
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  localStorage.clear();
});
afterEach(() => {
  mocks.hold = undefined;
  mocks.flow = { build: "done", deploy: "active" };
  // eslint-disable-next-line unicorn/no-null -- `useProgramInfo()` answers `null` for a failed chain read, no keypair and no build
  mocks.programInfo = { onChain: null, pk: null, uuid: null };
  mocks.deployState = "ready";
  mocks.history = [];
  // eslint-disable-next-line unicorn/no-null -- `PgWallet.current` is `null` while no wallet is current
  mocks.wallet.current = null;
  mocks.wallet.accounts = [];
  mocks.endpointCluster = "devnet";
  mocks.duringNetworkRead = undefined;
  resetTelemetry();
  vi.clearAllMocks();
});

/** The stale-build question the running deploy is asking */
const confirmStaleBuild = () => {
  const { answers } = PgDeployRun;
  if (!answers) throw new Error("no deploy is running, so nothing is asking");
  return answers.confirmStaleBuild();
};

/** Every event the stage sent, by name */
const events = () => sent.events.map((e) => e.name);

const pressDeploy = async () =>
  act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }))
  );

describe("Deploy stage", () => {
  // The server keeps the last good binary after a failed build, and the
  // stage's "Your last build failed" question is how the user opts into it
  it("keeps Deploy enabled after a failed build when a binary exists", () => {
    mocks.flow = { build: "failed", deploy: "active" };
    // eslint-disable-next-line unicorn/no-null -- `useProgramInfo()` answers `null` for a failed chain read and no keypair
    mocks.programInfo = { onChain: null, pk: null, uuid: "previous-build" };
    render(<Deploy onChangeNetwork={() => {}} />);

    const button = screen.getByRole("button", { name: "Deploy to devnet" });
    expect(button).toHaveProperty("disabled", false);
  });

  it("offers Go to Build, not Deploy, after a failed build when no binary exists", () => {
    mocks.flow = { build: "failed", deploy: "active" };
    render(<Deploy onChangeNetwork={() => {}} />);

    expect(screen.getByRole("button", { name: "Go to Build" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Deploy to devnet" })
    ).toBeNull();
  });

  it("holds the pill on what the status reads", () => {
    mocks.hold = "You're offline";
    render(<Deploy onChangeNetwork={() => {}} />);
    expect(screen.getByRole("button", { name: /Deploy to/ })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("reports a deploy that fails", async () => {
    const failure = new Error("insufficient balance");
    mocks.execute.mockRejectedValue(failure);
    render(<Deploy onChangeNetwork={() => {}} />);

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
    render(<Deploy onChangeNetwork={() => {}} />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }))
    );

    expect(mocks.markShown).toHaveBeenCalledWith(failure);
  });

  it("leaves a deploy that never started to the toast", async () => {
    const failure = new Error("no terminal");
    mocks.execute.mockRejectedValue(failure);
    render(<Deploy onChangeNetwork={() => {}} />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }))
    );

    expect(mocks.markShown).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(failure);
  });

  it("holds the button while a deploy is under way", () => {
    mocks.deployState = "loading";
    render(<Deploy onChangeNetwork={() => {}} />);

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
    render(<Deploy onChangeNetwork={() => {}} />);

    expect(
      screen.getByRole("status", { name: "Deploy result" }).textContent
    ).toContain("Deployed to devnet");
    expect(
      screen.getByRole("button", { name: "Redeploy to devnet" })
    ).toBeTruthy();
  });

  // A switch from the stage goes through Settings' pick, which refuses while
  // a deploy or an `anchor idl` write holds the network
  it("asks Settings' pick for the network a deployment was made on", () => {
    mocks.history = [
      {
        id: "a",
        workspace: "counter",
        cluster: "testnet",
        programId: "Prog111",
        // eslint-disable-next-line unicorn/no-null -- `DeployRecord.signature` is `null` when no signature was kept
        signature: null,
        at: 1,
      },
    ];
    render(<Deploy onChangeNetwork={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /^Show / }));
    expect(mocks.pickNetwork).toHaveBeenCalledWith(
      NETWORKS.find((n) => n.cluster === "testnet")?.value
    );
  });

  /** The Program id block's custom id is where the deploy goes */
  it("leaves a custom program id in place", async () => {
    mocks.execute.mockResolvedValue(undefined);
    render(<Deploy onChangeNetwork={() => {}} />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }))
    );

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalled();
  });

  it("opens the Build stage from Go to Build while nothing is built", () => {
    mocks.flow = { build: "active", deploy: "upcoming" };
    render(<Deploy onChangeNetwork={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Go to Build" }));
    expect(mocks.setStage).toHaveBeenCalledWith("build");
  });

  it("opens the console from Show full log after a failed deploy", () => {
    mocks.flow = { build: "done", deploy: "failed" };
    render(<Deploy onChangeNetwork={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Show full log" }));
    expect(mocks.requestConsole).toHaveBeenCalled();
  });

  it("creates the Playground wallet it pays from, without a dialog", async () => {
    // The wallet becomes current only after its derivation settles, as
    // `PgWallet.current` does; the deploy's own wallet check must see it
    mocks.wallet.add.mockImplementation(() => setTimeout(becomeCurrent));
    let walletAtDeploy: string | undefined = "not run";
    mocks.execute.mockImplementation(async () => {
      walletAtDeploy = mocks.wallet.current?.publicKey.toBase58();
    });
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();
    await act(async () => new Promise((r) => setTimeout(r, 10)));

    expect(mocks.wallet.add).toHaveBeenCalledOnce();
    expect(mocks.wallet.switch).not.toHaveBeenCalled();
    expect(walletAtDeploy).toBe(WALLET);
  });

  it("asks about a failed build in the panel and stops on Cancel", async () => {
    mocks.wallet.current = pgWallet();
    let answer: Promise<boolean> | undefined;
    mocks.execute.mockImplementation(async () => {
      answer = confirmStaleBuild();
      if (!(await answer)) throw new DeployCancelledError();
    });
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();
    expect(
      screen.getByRole("dialog", { name: "The last build failed" })
    ).toBeTruthy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    );

    await expect(answer).resolves.toBe(false);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(events()).not.toContain("deploy_failed");
  });

  it("shows the funding card and its event when the airdrop is refused", async () => {
    mocks.wallet.current = pgWallet();
    mocks.execute.mockRejectedValue(
      new DeployFundingError({
        reason: "airdrop_failed",
        balance: 0,
        needed: 1_000_000_000,
        address: WALLET,
        cause: "429",
      })
    );
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    expect(screen.getByRole("alert", { name: "Not enough SOL" })).toBeTruthy();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(events()).toEqual([
      "deploy_started",
      "deploy_sol_needed_shown",
      "deploy_failed",
    ]);
  });

  it("offers the keypair backup once per wallet after a deploy", async () => {
    mocks.wallet.current = pgWallet();
    mocks.execute.mockResolvedValue({
      signature: "sig",
      cost: 1,
      upgraded: false,
      cluster: "devnet",
    });
    mocks.history = [
      {
        id: "a",
        workspace: "counter",
        cluster: "devnet",
        programId: "Prog111",
        signature: "sig",
        at: 1,
      },
    ];
    render(<Deploy onChangeNetwork={() => {}} />);

    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Redeploy to devnet" })
      )
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Not now" }))
    );

    expect(screen.queryByLabelText("Keypair backup")).toBeNull();
    expect(events()).toEqual([
      "deploy_started",
      "deploy_succeeded",
      "deploy_backup_shown",
      "deploy_backup_dismissed",
    ]);

    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Redeploy to devnet" })
      )
    );
    expect(screen.queryByLabelText("Keypair backup")).toBeNull();
  });

  it("keeps the failed-build question across a switch away and back", async () => {
    mocks.wallet.current = pgWallet();
    let answer: Promise<boolean> | undefined;
    mocks.execute.mockImplementation(async () => {
      answer = confirmStaleBuild();
      await answer;
    });
    const first = render(<Deploy onChangeNetwork={() => {}} />);
    await pressDeploy();
    first.unmount();

    render(<Deploy onChangeNetwork={() => {}} />);
    expect(
      screen.getByRole("dialog", { name: "The last build failed" })
    ).toBeTruthy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Deploy last build" }))
    );

    await expect(answer).resolves.toBe(true);
  });

  it("starts one deploy however often Deploy is pressed while it starts", async () => {
    mocks.wallet.current = pgWallet();
    let finish = () => {};
    mocks.execute.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();
    fireEvent.click(screen.getByRole("button", { name: "Deploying..." }));
    await act(async () => finish());

    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("names the step a deploy failed at, after the run has reset", async () => {
    mocks.wallet.current = pgWallet();
    mocks.execute.mockImplementation(async () => {
      PgDeployRun.update({ step: "write", percent: 40 });
      PgDeployRun.reset();
      throw new Error("write failed");
    });
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    const failed = sent.events.find((e) => e.name === "deploy_failed");
    expect(failed?.params).toEqual({ cluster: "devnet", step: "write" });
  });

  it("reports a success on the network the deploy ran on", async () => {
    // The run deployed to testnet; devnet is selected by the time it ends
    mocks.execute.mockResolvedValue({
      signature: "sig",
      cost: 1,
      upgraded: false,
      cluster: "testnet",
    });
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    const succeeded = sent.events.find((e) => e.name === "deploy_succeeded");
    expect(succeeded?.params).toEqual({ cluster: "testnet", redeploy: false });
  });

  it("reports no success event when the deploy could not name its network", async () => {
    // Devnet is selected, but the run's own network is unknown
    mocks.execute.mockResolvedValue({
      signature: "sig",
      cost: 1,
      upgraded: false,
      // eslint-disable-next-line unicorn/no-null -- `DeployResult.cluster` is `null` when the run's network is unknown
      cluster: null,
    });
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    expect(mocks.execute).toHaveBeenCalledOnce();
    const names = sent.events.map((e) => e.name);
    expect(names).not.toContain("deploy_succeeded");
    expect(names).not.toContain("deploy_failed");
  });

  it("saves the keypair from the backup line, and keeps the line when the save fails", async () => {
    // A wallet of its own: the page remembers answers given earlier
    mocks.wallet.current = {
      isPg: true,
      publicKey: {
        toBase58: () => FRESH_WALLET,
      },
    };
    mocks.execute.mockResolvedValue({
      signature: "s",
      cost: 1,
      upgraded: false,
    });
    mocks.history = [
      {
        id: "a",
        workspace: "counter",
        cluster: "devnet",
        programId: "Prog111",
        signature: "s",
        at: 1,
      },
    ];
    render(<Deploy onChangeNetwork={() => {}} />);
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Redeploy to devnet" })
      )
    );

    mocks.wallet.export.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save keypair" }))
    );
    expect(screen.getByLabelText("Keypair backup")).toBeTruthy();

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save keypair" }))
    );
    expect(mocks.wallet.export).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText("Keypair backup")).toBeNull();
    expect(events()).toContain("deploy_backup_saved");
  });

  it("offers no keypair backup for a wallet that is not the Playground's", async () => {
    mocks.wallet.current = {
      isPg: false,
      publicKey: { toBase58: () => WALLET },
    };
    mocks.execute.mockResolvedValue({
      signature: "s",
      cost: 1,
      upgraded: false,
    });
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    expect(events()).not.toContain("deploy_backup_shown");
  });

  it("signs in from the funding card, then deploys again", async () => {
    mocks.wallet.current = pgWallet();
    mocks.execute.mockRejectedValueOnce(
      new DeployFundingError({
        reason: "signed_out",
        balance: 0,
        needed: 1,
        address: WALLET,
        // eslint-disable-next-line unicorn/no-null -- `DeployFundingError`'s `cause` is `string | null`
        cause: null,
      })
    );
    mocks.execute.mockResolvedValueOnce(undefined);
    mocks.signIn.mockResolvedValue(undefined);
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    );

    expect(mocks.signInFor).toHaveBeenCalledExactlyOnceWith("deploy");
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith([]);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  /** What the deploy run was told about airdrops, per run */
  const airdropAnswers = () => {
    const seen: Array<boolean | undefined> = [];
    mocks.execute.mockImplementation(async () => {
      seen.push(PgDeployRun.answers?.airdrop);
      return undefined;
    });
    return seen;
  };

  const airdropOff = () =>
    new DeployFundingError({
      reason: "airdrop_off",
      balance: 0,
      needed: 1,
      address: WALLET,
      // eslint-disable-next-line unicorn/no-null -- `DeployFundingError`'s `cause` is `string | null`
      cause: null,
    });

  it("deploys without an airdrop while automatic airdrop is off", async () => {
    mocks.wallet.current = pgWallet();
    const seen = airdropAnswers();
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    expect(seen).toEqual([false]);
  });

  it("deploys with an airdrop when automatic airdrop is on", async () => {
    mocks.wallet.current = pgWallet();
    mocks.automaticAirdrop = true;
    const seen = airdropAnswers();
    render(<Deploy onChangeNetwork={() => {}} />);

    try {
      await pressDeploy();
    } finally {
      mocks.automaticAirdrop = false;
    }

    expect(seen).toEqual([true]);
  });

  it("asks for the Fund dialog from the funding card", async () => {
    mocks.wallet.current = pgWallet();
    mocks.execute.mockRejectedValueOnce(airdropOff());
    const asked: string[] = [];
    const stop = onDidRequestFundDialog((from) => asked.push(from));
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();
    fireEvent.click(
      screen.getByRole("button", { name: "Send from your wallet" })
    );
    stop();

    expect(asked).toEqual(["deploy-card"]);
  });

  it("requests an airdrop only on the funding card's press", async () => {
    mocks.wallet.current = pgWallet();
    const seen = airdropAnswers();
    mocks.execute.mockImplementationOnce(async () => {
      seen.push(PgDeployRun.answers?.airdrop);
      throw airdropOff();
    });
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Request airdrop" }))
    );

    expect(seen).toEqual([false, true]);
  });

  it("requests an airdrop again on Try again after the faucet refused", async () => {
    mocks.wallet.current = pgWallet();
    const seen = airdropAnswers();
    mocks.execute
      .mockImplementationOnce(async () => {
        seen.push(PgDeployRun.answers?.airdrop);
        throw airdropOff();
      })
      .mockImplementationOnce(async () => {
        seen.push(PgDeployRun.answers?.airdrop);
        throw new DeployFundingError({
          reason: "airdrop_failed",
          balance: 0,
          needed: 1,
          address: WALLET,
          cause: "429",
        });
      });
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Request airdrop" }))
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    );

    expect(seen).toEqual([false, true, true]);
  });

  it("requests an airdrop on the deploy that follows a sign-in from the card", async () => {
    mocks.wallet.current = pgWallet();
    const seen = airdropAnswers();
    mocks.execute.mockImplementationOnce(async () => {
      seen.push(PgDeployRun.answers?.airdrop);
      throw new DeployFundingError({
        reason: "signed_out",
        balance: 0,
        needed: 1,
        address: WALLET,
        // eslint-disable-next-line unicorn/no-null -- `DeployFundingError`'s `cause` is `string | null`
        cause: null,
      });
    });
    mocks.signIn.mockResolvedValue(undefined);
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    );

    expect(seen).toEqual([false, true]);
  });

  it("does not deploy after a sign-in that ended on another project", async () => {
    const utils = (await import("../../../utils")) as unknown as {
      PgExplorer: { currentWorkspaceName: string };
    };
    mocks.wallet.current = pgWallet();
    mocks.execute.mockRejectedValueOnce(
      new DeployFundingError({
        reason: "signed_out",
        balance: 0,
        needed: 1,
        address: WALLET,
        // eslint-disable-next-line unicorn/no-null -- `DeployFundingError`'s `cause` is `string | null`
        cause: null,
      })
    );
    mocks.signIn.mockImplementation(async () => {
      utils.PgExplorer.currentWorkspaceName = "other";
    });
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    );
    utils.PgExplorer.currentWorkspaceName = "counter";

    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("connects the existing Playground account rather than adding one", async () => {
    mocks.wallet.accounts = [{}];
    mocks.wallet.switch.mockImplementation(becomeCurrent);
    mocks.execute.mockResolvedValue(undefined);
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    expect(mocks.wallet.switch).toHaveBeenCalledWith(0);
    expect(mocks.wallet.add).not.toHaveBeenCalled();
  });

  it("starts nothing while a deploy typed in the terminal runs", async () => {
    mocks.deployState = "loading";
    render(<Deploy onChangeNetwork={() => {}} />);

    await act(async () => PgStageDeploy.start());

    expect(mocks.execute).not.toHaveBeenCalled();
  });

  // HOO-2728: the stage shows the CLI guide on mainnet, but the network can
  // move there before the press is read; the refusal comes before the wallet
  it("refuses a mainnet deploy before creating a wallet, and counts no failure", async () => {
    mocks.endpointCluster = "mainnet-beta";
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    expect(mocks.wallet.add).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    const [refusal] = mocks.report.mock.calls[0] ?? [];
    expect((refusal as Error | undefined)?.message).toBe(
      MAINNET_DEPLOY_BLOCKED
    );
    // The toast names the way on, not "Could not deploy."
    expect(mocks.markUnavailable).toHaveBeenCalledWith(
      refusal,
      MAINNET_DEPLOY_WAY_OUT
    );
    expect(events()).not.toContain("deploy_started");
    expect(events()).not.toContain("deploy_failed");
  });

  // The command refuses an unread network in the terminal, with its own line
  it("leaves an endpoint that did not answer to the deploy command", async () => {
    mocks.wallet.current = pgWallet();
    mocks.endpointCluster = "unread";
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  // The network read can wait on a slow endpoint; the press was for the
  // project open when it was made, never for the one open after the wait
  it("does not deploy a project opened while the network was read", async () => {
    const utils = (await import("../../../utils")) as unknown as {
      PgExplorer: { currentWorkspaceName: string };
    };
    mocks.wallet.current = pgWallet();
    mocks.duringNetworkRead = () => {
      utils.PgExplorer.currentWorkspaceName = "other";
    };
    render(<Deploy onChangeNetwork={() => {}} />);

    try {
      await pressDeploy();
    } finally {
      utils.PgExplorer.currentWorkspaceName = "counter";
    }

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(PgStageDeploy.state).toEqual({
      phase: "stopped",
      stop: { kind: "cancelled" },
    });
  });

  // A custom RPC's cluster name can arrive during the read; the endpoint,
  // and so the network, is the same one the press was for
  it("deploys when only the cluster's name arrived during the network read", async () => {
    const utils = (await import("../../../utils")) as unknown as {
      PgConnection: { cluster: string | undefined };
    };
    mocks.wallet.current = pgWallet();
    mocks.execute.mockResolvedValue(undefined);
    mocks.duringNetworkRead = () => {
      utils.PgConnection.cluster = "testnet";
    };
    render(<Deploy onChangeNetwork={() => {}} />);

    try {
      await pressDeploy();
    } finally {
      utils.PgConnection.cluster = "devnet";
    }

    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("names the checks when a deploy fails before any step", async () => {
    mocks.wallet.current = pgWallet();
    mocks.execute.mockRejectedValue(new Error("not built"));
    render(<Deploy onChangeNetwork={() => {}} />);

    await pressDeploy();

    const failed = sent.events.find((e) => e.name === "deploy_failed");
    expect(failed?.params).toEqual({ cluster: "devnet", step: "checks" });
  });

  it("gives up on a wallet that never connects, says so, and leaves nothing listening", async () => {
    vi.useFakeTimers();
    try {
      mocks.wallet.add.mockImplementation(() => undefined);
      render(<Deploy onChangeNetwork={() => {}} />);

      await pressDeploy();
      await act(async () => vi.advanceTimersByTimeAsync(15_000));

      expect(mocks.execute).not.toHaveBeenCalled();
      expect(String(mocks.report.mock.calls[0]?.[0])).toContain(
        "did not connect"
      );
      expect(mocks.walletListeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows only the running deploy when the terminal deploys over a funding stop", async () => {
    mocks.wallet.current = pgWallet();
    mocks.execute.mockRejectedValue(
      new DeployFundingError({
        reason: "airdrop_failed",
        balance: 0,
        needed: 1,
        address: WALLET,
        cause: "429",
      })
    );
    const view = render(<Deploy onChangeNetwork={() => {}} />);
    await pressDeploy();
    expect(screen.getByRole("alert", { name: "Not enough SOL" })).toBeTruthy();

    mocks.deployState = "loading";
    view.rerender(
      <TooltipProvider>
        <Deploy onChangeNetwork={() => {}} />
      </TooltipProvider>
    );

    expect(screen.queryByRole("alert", { name: "Not enough SOL" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Deploying..." })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("shows the funding card only on the project and network it ran on", async () => {
    const utils = (await import("../../../utils")) as unknown as {
      PgConnection: { cluster: string };
      PgExplorer: { currentWorkspaceName: string };
    };
    mocks.wallet.current = pgWallet();
    mocks.execute.mockRejectedValue(
      new DeployFundingError({
        reason: "airdrop_failed",
        balance: 0,
        needed: 1,
        address: WALLET,
        cause: "429",
      })
    );
    const view = render(<Deploy onChangeNetwork={() => {}} />);
    await pressDeploy();
    expect(screen.getByRole("alert", { name: "Not enough SOL" })).toBeTruthy();

    const rerender = () =>
      view.rerender(
        <TooltipProvider>
          <Deploy onChangeNetwork={() => {}} />
        </TooltipProvider>
      );
    try {
      utils.PgConnection.cluster = "testnet";
      rerender();
      expect(
        screen.queryByRole("alert", { name: "Not enough SOL" })
      ).toBeNull();

      utils.PgConnection.cluster = "devnet";
      utils.PgExplorer.currentWorkspaceName = "other";
      rerender();
      expect(
        screen.queryByRole("alert", { name: "Not enough SOL" })
      ).toBeNull();
    } finally {
      utils.PgConnection.cluster = "devnet";
      utils.PgExplorer.currentWorkspaceName = "counter";
    }
  });
});
