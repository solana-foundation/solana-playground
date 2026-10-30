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

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  report: vi.fn(),
  deployState: "ready",
  history: [] as unknown[],
  update: vi.fn(),
  noop: () => ({ dispose: () => undefined }),
  wallet: {
    current: null as null | {
      isPg: boolean;
      publicKey: { toBase58: () => string };
    },
    accounts: [] as unknown[],
    currentIndex: -1,
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
}));

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const pgWallet = () => ({ isPg: true, publicKey: { toBase58: () => WALLET } });

// The real barrels pull in the whole playground; the stage reads only these
vi.mock("../../../utils", () => ({
  PgCommand: { deploy: { execute: mocks.execute } },
  PgConnection: { cluster: "devnet", onDidChangeCluster: "cluster" },
  PgExplorer: {
    currentWorkspaceName: "counter",
    onDidSwitchWorkspace: mocks.noop,
  },
  PgGlobal: {
    onDidChangeDeployState: "deployState",
    get deployState() {
      return mocks.deployState;
    },
  },
  PgProgramInfo: { update: mocks.update },
  PgWallet: mocks.wallet,
}));
vi.mock("@/features/auth", () => ({
  PgSession: { signIn: mocks.signIn },
  isSignInFailure: () => false,
}));
vi.mock("../../../hooks", () => ({
  useBlockExplorer: () => ({
    getAddressUrl: (id: string) => `https://explorer.test/address/${id}`,
    getTxUrl: (sig: string) => `https://explorer.test/tx/${sig}`,
    opens: () => true,
  }),
  useProgramInfo: () => ({ onChain: null, pk: null }),
  useWallet: () => mocks.wallet.current,
  useBalance: () => 4.2,
  useRenderOnChange: (event: string) =>
    event === "deployState" ? mocks.deployState : undefined,
}));
vi.mock("../state/stage", () => ({
  PgFlow: {
    state: { build: "done", deploy: "active" },
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
}));

import { TooltipProvider } from "@/shared/ui/tooltip";
import {
  DeployCancelledError,
  DeployFundingError,
  PgDeployRun,
} from "../../../commands/deploy/run";
import { PgStageDeploy } from "@/features/deploy";
import Deploy from "./Deploy";

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
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  localStorage.clear();
});
afterEach(() => {
  mocks.deployState = "ready";
  mocks.history = [];
  mocks.wallet.current = null;
  mocks.wallet.accounts = [];
  resetTelemetry();
  vi.clearAllMocks();
});

/** Every event the stage sent, by name */
const events = () => sent.events.map((e) => e.name);

const pressDeploy = async () =>
  act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }))
  );

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

    expect(
      screen.getByRole("status", { name: "Deploy result" }).textContent
    ).toContain("Deployed to devnet");
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

  it("creates the Playground wallet it pays from, without a dialog", async () => {
    // The wallet becomes current only after its derivation settles, as
    // `PgWallet.current` does; the deploy's own wallet check must see it
    mocks.wallet.add.mockImplementation(() => setTimeout(becomeCurrent));
    let walletAtDeploy: string | null = "not run";
    mocks.execute.mockImplementation(async () => {
      walletAtDeploy = mocks.wallet.current?.publicKey.toBase58() ?? null;
    });
    render(<Deploy />);

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
      answer = PgDeployRun.answers!.confirmStaleBuild();
      if (!(await answer)) throw new DeployCancelledError();
    });
    render(<Deploy />);

    await pressDeploy();
    expect(
      screen.getByRole("dialog", { name: "Your last build failed" })
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
    render(<Deploy />);

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
    render(<Deploy />);

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
      answer = PgDeployRun.answers!.confirmStaleBuild();
      await answer;
    });
    const first = render(<Deploy />);
    await pressDeploy();
    first.unmount();

    render(<Deploy />);
    expect(
      screen.getByRole("dialog", { name: "Your last build failed" })
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
    render(<Deploy />);

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
    render(<Deploy />);

    await pressDeploy();

    const failed = sent.events.find((e) => e.name === "deploy_failed");
    expect(failed?.params).toEqual({ cluster: "devnet", step: "write" });
  });

  it("saves the keypair from the backup line, and keeps the line when the save fails", async () => {
    // A wallet of its own: the page remembers answers given earlier
    mocks.wallet.current = {
      isPg: true,
      publicKey: {
        toBase58: () => "SaveWa11et1111111111111111111111111111111111",
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
    render(<Deploy />);
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
    render(<Deploy />);

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
        cause: null,
      })
    );
    mocks.execute.mockResolvedValueOnce(undefined);
    mocks.signIn.mockResolvedValue(undefined);
    render(<Deploy />);

    await pressDeploy();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Sign in with GitHub" })
      )
    );

    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("connects the existing Playground account rather than adding one", async () => {
    mocks.wallet.accounts = [{}];
    mocks.wallet.switch.mockImplementation(becomeCurrent);
    mocks.execute.mockResolvedValue(undefined);
    render(<Deploy />);

    await pressDeploy();

    expect(mocks.wallet.switch).toHaveBeenCalledWith(0);
    expect(mocks.wallet.add).not.toHaveBeenCalled();
  });

  it("starts nothing while a deploy typed in the terminal runs", async () => {
    mocks.deployState = "loading";
    render(<Deploy />);

    await act(async () => PgStageDeploy.start());

    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("names the checks when a deploy fails before any step", async () => {
    mocks.wallet.current = pgWallet();
    mocks.execute.mockRejectedValue(new Error("not built"));
    render(<Deploy />);

    await pressDeploy();

    const failed = sent.events.find((e) => e.name === "deploy_failed");
    expect(failed?.params).toEqual({ cluster: "devnet", step: "checks" });
  });

  it("gives up on a wallet that never connects, says so, and leaves nothing listening", async () => {
    vi.useFakeTimers();
    try {
      mocks.wallet.add.mockImplementation(() => undefined);
      render(<Deploy />);

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
    const view = render(<Deploy />);
    await pressDeploy();
    expect(screen.getByRole("alert", { name: "Not enough SOL" })).toBeTruthy();

    const rerender = () =>
      view.rerender(
        <TooltipProvider>
          <Deploy />
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
