import { describe, expect, it, vi, beforeEach } from "vitest";

import { PgSession } from "../../features/auth";
import { PgCommand, PgProgramInfo, PgTerminal } from "../../utils";
import { deploy } from "./deploy";
import { DeployCancelledError, DeployFundingError, PgDeployRun } from "./run";
import type { DeployRunState } from "./run";

const WALLET = "Wa11et1111111111111111111111111111111111111";
const balance = vi.fn(async () => 10_000_000_000);
const waitForInput = vi.fn(async () => true);

vi.mock("../../features/auth", () => ({
  PgSession: { get: vi.fn(() => ({ id: "u1" })) },
}));

// The chain answers every transaction at once; the tests read the steps the
// run reports and what it asks, not what reaches the cluster
vi.mock("./bpf-loader-upgradeable", () => ({
  BpfLoaderUpgradeable: {
    createBuffer: vi.fn(async () => "sig-buffer"),
    loadBuffer: vi.fn(
      async (
        _pk: unknown,
        _bytes: unknown,
        opts: { onWrite: (c: number, t: number) => void }
      ) => {
        opts.onWrite(1, 2);
        opts.onWrite(2, 2);
      }
    ),
    deployProgram: vi.fn(async () => "sig-deploy"),
    upgradeProgram: vi.fn(async () => "sig-upgrade"),
  },
}));

vi.mock("../../utils", () => {
  const pk = { toBase58: () => WALLET, equals: () => true };
  return {
    PgCommand: { airdrop: { execute: vi.fn(async () => {}) } },
    PgCommon: { formatSeconds: () => "1s", makePlural: (s: string) => s },
    PgConnection: {
      cluster: "devnet",
      getAirdropAmount: vi.fn((): number | null => 5),
      current: {
        getBalance: (...args: unknown[]) => balance(...(args as [])),
        getMinimumBalanceForRentExemption: async (len: number) => len,
        getAccountInfo: async () => null,
      },
    },
    PgGlobal: {
      deployState: "ready",
      update: vi.fn(),
      onDidChangeDeployState: () => ({ dispose: () => {} }),
    },
    PgProgramInfo: {
      uuid: "u",
      importedProgram: { bytes: new Uint8Array(100) },
      lastBuildFailed: false,
      pk,
      kp: { publicKey: pk },
      onChain: { deployed: false, upgradable: true, programDataLen: 0 },
    },
    PgServer: {},
    PgTerminal: {
      println: vi.fn(),
      info: (t: string) => t,
      success: (t: string) => t,
      warning: (t: string) => t,
      error: (t: string) => t,
      bold: (t: string) => t,
      get: async () => ({ waitForInput, println: vi.fn() }),
    },
    PgTx: { confirm: async () => ({ err: null }) },
    PgView: { setMainSecondaryProgress: vi.fn() },
    PgWallet: { current: { publicKey: pk, isPg: true } },
    PgWeb3: {
      Keypair: { generate: () => ({ publicKey: pk }) },
      BpfLoaderUpgradeableProgram: {
        getBufferAccountSize: (n: number) => n,
        getProgramDataAccountSize: (n: number) => n + 45,
        MINIMUM_EXTEND_PROGRAM_BYTES: 100,
      },
      lamportsToSol: (l: number) => l / 1e9,
      solToLamports: (s: number) => s * 1e9,
      DEFAULT_MS_PER_SLOT: 1,
    },
  };
});

const answers = (stale = true) => ({
  confirmStaleBuild: vi.fn(async () => stale),
});

const subscriptions: Array<{ dispose: () => void }> = [];

/** Every step the run reported, in order, without repeats */
const recordSteps = () => {
  const steps: Array<DeployRunState["step"]> = [];
  subscriptions.push(
    PgDeployRun.onDidChange(({ step }) => {
      if (step && steps.at(-1) !== step) steps.push(step);
    })
  );
  return steps;
};

const runChecks = async () => {
  const checks = deploy.preChecks as Array<() => Promise<void>>;
  for (const check of checks.slice(1)) await check();
};

beforeEach(() => {
  for (const sub of subscriptions.splice(0)) sub.dispose();
  vi.clearAllMocks();
  balance.mockResolvedValue(10_000_000_000);
  Object.assign(PgProgramInfo, {
    lastBuildFailed: false,
    importedProgram: { bytes: new Uint8Array(100) },
    onChain: { deployed: false, upgradable: true, programDataLen: 0 },
  });
});

/** The last build failed, and the binary comes from the build server */
const lastBuildFailed = () =>
  Object.assign(PgProgramInfo, {
    lastBuildFailed: true,
    importedProgram: null,
  });

describe("deploy run", () => {
  it("reports buffer, write and deploy in order, and returns the deploy's result", async () => {
    const steps = recordSteps();
    balance
      .mockResolvedValueOnce(10_000_000_000) // read against what it needs
      .mockResolvedValueOnce(10_000_000_000) // before the run spends
      .mockResolvedValueOnce(9_000_000_000); // after it

    const result = await deploy.handle!({} as never);

    expect(steps).toEqual(["buffer", "write", "deploy"]);
    expect(result).toEqual({
      signature: "sig-deploy",
      cost: 1_000_000_000,
      upgraded: false,
    });
    expect(PgDeployRun.state.step).toBeNull();
  });

  it("funds first, without a question, when the stage started it", async () => {
    const steps = recordSteps();
    balance.mockResolvedValueOnce(0);

    await PgDeployRun.withAnswers(answers(), () => deploy.handle!({} as never));

    expect(steps[0]).toBe("funding");
    expect(PgCommand.airdrop.execute).toHaveBeenCalledWith("1");
    expect(waitForInput).not.toHaveBeenCalled();
  });

  it("asks in the terminal before funding a typed deploy", async () => {
    balance.mockResolvedValueOnce(0);

    await deploy.handle!({} as never);

    expect(waitForInput).toHaveBeenCalledOnce();
  });

  it("stops with the reason when the stage's airdrop is refused", async () => {
    balance.mockResolvedValueOnce(0);
    vi.mocked(PgCommand.airdrop.execute).mockRejectedValueOnce(
      new Error("429 Too Many Requests")
    );

    const run = PgDeployRun.withAnswers(answers(), () =>
      deploy.handle!({} as never)
    );

    await expect(run).rejects.toBeInstanceOf(DeployFundingError);
    await run.catch((e: DeployFundingError) => {
      expect(e.detail).toMatchObject({
        reason: "airdrop_failed",
        balance: 0,
        address: WALLET,
        cause: "429 Too Many Requests",
      });
    });
  });

  it("asks a signed-out user to sign in instead of requesting SOL", async () => {
    balance.mockResolvedValueOnce(0);
    vi.mocked(PgSession.get).mockReturnValueOnce(null as never);

    const run = PgDeployRun.withAnswers(answers(), () =>
      deploy.handle!({} as never)
    );

    await expect(run).rejects.toMatchObject({
      detail: { reason: "signed_out" },
    });
    expect(PgCommand.airdrop.execute).not.toHaveBeenCalled();
  });

  it("says there is no faucet where the network has none", async () => {
    balance.mockResolvedValueOnce(0);
    const { PgConnection } = await import("../../utils");
    vi.mocked(PgConnection.getAirdropAmount).mockReturnValueOnce(null);

    const run = PgDeployRun.withAnswers(answers(), () =>
      deploy.handle!({} as never)
    );

    await expect(run).rejects.toMatchObject({
      detail: { reason: "no_faucet" },
    });
  });

  it("takes the stage's answer about a failed build, not the terminal's", async () => {
    lastBuildFailed();
    const said = answers(false);

    const run = PgDeployRun.withAnswers(said, runChecks);

    await expect(run).rejects.toBeInstanceOf(DeployCancelledError);
    expect(said.confirmStaleBuild).toHaveBeenCalledOnce();
    expect(waitForInput).not.toHaveBeenCalled();
    expect(PgTerminal.println).not.toHaveBeenCalled();
  });

  it("keeps the terminal's question about a failed build for a typed deploy", async () => {
    lastBuildFailed();

    await runChecks();

    expect(waitForInput).toHaveBeenCalledOnce();
  });

  it("upgrades a program that is already on the cluster", async () => {
    Object.assign(PgProgramInfo, {
      onChain: { deployed: true, upgradable: true, programDataLen: 1000 },
    });
    const upgrades: boolean[] = [];
    subscriptions.push(
      PgDeployRun.onDidChange(({ upgrade }) => upgrades.push(upgrade))
    );

    const result = await deploy.handle!({} as never);

    expect(result).toMatchObject({ signature: "sig-upgrade", upgraded: true });
    expect(upgrades).toContain(true);
  });

  it("goes back to no run after a failure", async () => {
    const { BpfLoaderUpgradeable } = await import("./bpf-loader-upgradeable");
    vi.mocked(BpfLoaderUpgradeable.deployProgram).mockRejectedValue(
      new Error("rpc down")
    );

    await expect(deploy.handle!({} as never)).rejects.toThrow();

    expect(PgDeployRun.state.step).toBeNull();
    expect(PgDeployRun.lastStep).toBe("deploy");
    vi.mocked(BpfLoaderUpgradeable.deployProgram).mockResolvedValue(
      "sig-deploy"
    );
  });

  it("deploys the last successful build when the stage says yes", async () => {
    lastBuildFailed();
    const said = answers(true);

    await expect(
      PgDeployRun.withAnswers(said, runChecks)
    ).resolves.toBeUndefined();

    expect(said.confirmStaleBuild).toHaveBeenCalledOnce();
    expect(waitForInput).not.toHaveBeenCalled();
  });

  it("drops the stage's answers once its run ends, however it ends", async () => {
    await PgDeployRun.withAnswers(answers(), async () => undefined);
    expect(PgDeployRun.answers).toBeNull();

    await PgDeployRun.withAnswers(answers(), async () => {
      throw new Error("failed");
    }).catch(() => undefined);
    expect(PgDeployRun.answers).toBeNull();
  });

  it("counts what both wallets spent when a connected wallet pays", async () => {
    const utils = await import("../../utils");
    const pgPk = { toBase58: () => "PgWa11et", equals: () => true };
    const before: Record<string, number> = {
      [WALLET]: 5_000_000_000,
      PgWa11et: 0,
    };
    const after: Record<string, number> = {
      [WALLET]: 3_000_000_000,
      PgWa11et: 1_500_000_000,
    };
    let reads = 0;
    balance.mockImplementation(async (...args: unknown[]) => {
      reads += 1;
      const key = (args[0] as { toBase58: () => string }).toBase58();
      // The first read checks the balance against what the deploy needs,
      // the next two are the run's "before", the last two its "after"
      return (reads <= 3 ? before : after)[key];
    });
    const standard = {
      publicKey: utils.PgWallet.current!.publicKey,
      isPg: false,
    };
    Object.assign(utils.PgWallet, {
      current: standard,
      accounts: [{}],
      create: () => ({ publicKey: pgPk, isPg: true }),
    });
    Object.assign(utils.PgTx, { send: async () => "sig-transfer" });
    Object.assign(utils.PgWeb3, {
      SystemProgram: { transfer: () => ({}) },
    });
    const { BpfLoaderUpgradeable } = await import("./bpf-loader-upgradeable");
    Object.assign(BpfLoaderUpgradeable, {
      setBufferAuthority: async () => "sig-authority",
    });

    try {
      const result = await deploy.handle!({} as never);
      expect(result?.cost).toBe(500_000_000);
    } finally {
      Object.assign(utils.PgWallet, {
        current: { publicKey: standard.publicKey, isPg: true },
      });
    }
  });
});
