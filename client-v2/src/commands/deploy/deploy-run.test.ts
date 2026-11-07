import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgSession } from "../../features/auth";
import { PgCommand, PgProgramInfo, PgTerminal } from "../../utils";
import { deploy } from "./deploy";
import type { DeployRunState } from "./run";
import { DeployCancelledError, DeployFundingError, PgDeployRun } from "./run";

const WALLET = "Wa11et1111111111111111111111111111111111111";
const balance = vi.fn(async () => 10_000_000_000);
const waitForInput = vi.fn(async () => true);

const chain = vi.hoisted(() => ({
  /** What `getReadBufferConnection` answers; the selected connection when unset */
  readBuffer: undefined as
    | { getAccountInfo: () => Promise<object | undefined> }
    | undefined,
  /** Buffer reads through the selected connection */
  selectedReads: 0,
  /** A confirmation's `err`; once set, every send's own check decides whether it landed */
  confirmErr: undefined as string | undefined,
}));

vi.mock("../../features/auth", () => ({
  PgSession: { get: vi.fn(() => ({ id: "u1" })) },
}));

// The chain answers every transaction at once; the tests read the steps the
// run reports and what it asks, not what reaches the cluster
vi.mock("./bpf-loader-upgradeable", () => ({
  BpfLoaderUpgradeable: {
    createBuffer: vi.fn(async () => "sig-buffer"),
    // The arguments are (program id, bytes, options); only the options matter
    loadBuffer: vi.fn(
      async (
        ...args: [unknown, unknown, { onWrite: (c: number, t: number) => void }]
      ) => {
        const [, , opts] = args;
        opts.onWrite(1, 2);
        opts.onWrite(2, 2);
      }
    ),
    deployProgram: vi.fn(async () => "sig-deploy"),
    extendProgram: vi.fn(async () => "sig-extend"),
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
      getCluster: vi.fn(async () => "devnet"),
      getAirdropAmount: vi.fn((): number | null => 5),
      getReadBufferConnection: <T>(connection: T) =>
        chain.readBuffer ?? connection,
      current: {
        getBalance: (...args: unknown[]) => balance(...(args as [])),
        getMinimumBalanceForRentExemption: async (len: number) => len,
        getAccountInfo: async () => {
          chain.selectedReads++;
          // eslint-disable-next-line unicorn/no-null -- web3's `getAccountInfo` answers `null` for no account
          return null;
        },
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
    PgTx: {
      // eslint-disable-next-line unicorn/no-null -- an RPC confirmation's `err` is `null` on success
      confirm: vi.fn(async () => ({ err: chain.confirmErr ?? null })),
    },
    PgView: { setMainSecondaryProgress: vi.fn() },
    PgWallet: { current: { publicKey: pk, isPg: true } },
    PgWeb3: {
      Keypair: { generate: () => ({ publicKey: pk }) },
      // Holds the bytes it was made from, so a stubbed read can tell accounts apart
      PublicKey: class {
        constructor(readonly bytes: Uint8Array) {}
      },
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

const answers = (stale: boolean) => ({
  confirmStaleBuild: vi.fn(async () => stale),
  airdrop: true,
});

/** The stage's answers with automatic airdrop off, the setting's default */
const answersWithoutAirdrop = (stale: boolean) => ({
  confirmStaleBuild: vi.fn(async () => stale),
  airdrop: false,
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
  chain.readBuffer = undefined;
  chain.selectedReads = 0;
  chain.confirmErr = undefined;
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
    importedProgram: undefined,
  });

/** The command context of a run nobody stops */
const noStop = () =>
  ({ signal: new AbortController().signal, lockStop: () => {} } as never);

/** The deploy command's handler, run on a context nobody stops */
const handleDeploy = () => {
  if (!deploy.handle) throw new Error("The deploy command has no handler");
  return deploy.handle(noStop());
};

describe("deploy run", () => {
  it("reports buffer, write and deploy in order, and returns the deploy's result", async () => {
    const steps = recordSteps();
    balance
      .mockResolvedValueOnce(10_000_000_000) // read against what it needs
      .mockResolvedValueOnce(10_000_000_000) // before the run spends
      .mockResolvedValueOnce(9_000_000_000); // after it

    const result = await handleDeploy();

    expect(steps).toEqual(["buffer", "write", "deploy"]);
    expect(result).toEqual({
      signature: "sig-deploy",
      cost: 1_000_000_000,
      upgraded: false,
      cluster: "devnet",
    });
    expect(PgDeployRun.state.step).toBeNull();
  });

  it("reports a confirmed deploy with no cost when the balance after it cannot be read", async () => {
    balance
      .mockResolvedValueOnce(10_000_000_000) // read against what it needs
      .mockResolvedValueOnce(10_000_000_000) // before the run spends
      .mockRejectedValueOnce(new Error("rpc down")); // after it

    const result = await handleDeploy();

    expect(result).toEqual({
      signature: "sig-deploy",
      cost: undefined,
      upgraded: false,
      cluster: "devnet",
    });
  });

  it("reports the network of the connection it used, not the one selected", async () => {
    const { PgConnection } = await import("../../utils");
    // The selected network is derived later and still names the old one
    Object.assign(PgConnection, { cluster: "devnet" });
    vi.mocked(PgConnection.getCluster).mockResolvedValueOnce("testnet");
    balance
      .mockResolvedValueOnce(10_000_000_000)
      .mockResolvedValueOnce(10_000_000_000)
      .mockResolvedValueOnce(9_000_000_000);

    const result = await handleDeploy();

    expect(result?.cluster).toBe("testnet");
  });

  /**
   * Change the network while the run's first balance read is in flight, as a
   * pick in Settings or the Deploy stage's network chip can
   */
  const switchNetworkOnFirstRead = async (lamports: number) => {
    const { PgConnection } = await import("../../utils");
    const start = PgConnection.current;
    const switched = {
      getBalance: start.getBalance,
      getMinimumBalanceForRentExemption:
        start.getMinimumBalanceForRentExemption,
      getAccountInfo: start.getAccountInfo,
      rpcEndpoint: "https://api.testnet.solana.com",
    };
    balance.mockImplementationOnce(async () => {
      Object.assign(PgConnection, { current: switched });
      return lamports;
    });
    return {
      start,
      restore: () => Object.assign(PgConnection, { current: start }),
    };
  };

  it.each([
    { verb: "deploys", deployed: false, last: "deployProgram" },
    { verb: "upgrades", deployed: true, last: "upgradeProgram" },
  ] as const)(
    "sends and confirms on the connection it started on when the network changes as it $verb",
    async ({ deployed, last }) => {
      const { PgTx } = await import("../../utils");
      const { BpfLoaderUpgradeable } = await import("./bpf-loader-upgradeable");
      Object.assign(PgProgramInfo, {
        onChain: { deployed, upgradable: true, programDataLen: 1000 },
      });
      const { start, restore } = await switchNetworkOnFirstRead(10_000_000_000);

      try {
        await handleDeploy();
      } finally {
        restore();
      }

      const lastArg = (calls: unknown[][]) => calls[0]?.at(-1);
      for (const opts of [
        lastArg(vi.mocked(BpfLoaderUpgradeable.createBuffer).mock.calls),
        lastArg(vi.mocked(BpfLoaderUpgradeable.loadBuffer).mock.calls),
        lastArg(vi.mocked(BpfLoaderUpgradeable[last]).mock.calls),
      ]) {
        expect(opts).toMatchObject({ connection: start });
      }
      const confirms = vi.mocked(PgTx.confirm).mock.calls as unknown[][];
      expect(confirms.length).toBeGreaterThan(0);
      for (const [, opts] of confirms) {
        expect(opts).toMatchObject({ connection: start });
      }
    }
  );

  it("takes an extend as confirmed from the program data on its own network, not the one picked", async () => {
    const { PgTx } = await import("../../utils");
    const { BpfLoaderUpgradeable } = await import("./bpf-loader-upgradeable");
    // The picked network's program info still says the program needs room
    Object.assign(PgProgramInfo, {
      onChain: { deployed: true, upgradable: true, programDataLen: 10 },
    });
    const { start, restore } = await switchNetworkOnFirstRead(10_000_000_000);
    // On the run's own network the extend landed: the program data has room
    const programDataPk = new Uint8Array(32).fill(7);
    const program = { data: Buffer.concat([Buffer.alloc(4), programDataPk]) };
    const extended = { data: Buffer.alloc(1000) };
    const read = start.getAccountInfo;
    Object.assign(start, {
      getAccountInfo: async (key: { bytes?: Uint8Array }) =>
        key?.bytes ? extended : program,
    });
    // The extend's confirmation reports an error, so the probe decides
    vi.mocked(PgTx.confirm).mockResolvedValueOnce({ err: "timeout" } as never);

    let result;
    try {
      result = await handleDeploy();
    } finally {
      restore();
      Object.assign(start, { getAccountInfo: read });
    }

    expect(BpfLoaderUpgradeable.extendProgram).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ signature: "sig-upgrade", upgraded: true });
  });

  it("asks no faucet when the network changed since the run started", async () => {
    const { restore } = await switchNetworkOnFirstRead(0);

    const run = PgDeployRun.runWith(answers(true))(handleDeploy);

    try {
      await expect(run).rejects.toThrow(
        "The network changed during the deploy"
      );
    } finally {
      restore();
    }
    expect(PgCommand.airdrop.execute).not.toHaveBeenCalled();
  });

  it("reports no network when the connection's cannot be read, not the one selected", async () => {
    const { PgConnection } = await import("../../utils");
    vi.mocked(PgConnection.getCluster).mockRejectedValueOnce(
      new Error("genesis hash unreadable")
    );
    balance
      .mockResolvedValueOnce(10_000_000_000)
      .mockResolvedValueOnce(10_000_000_000)
      .mockResolvedValueOnce(9_000_000_000);

    const result = await handleDeploy();

    expect(result?.signature).toBe("sig-deploy");
    expect(result?.cluster).toBeNull();
  });

  it("funds first, without a question, when the stage started it", async () => {
    const steps = recordSteps();
    balance.mockResolvedValueOnce(0);

    await PgDeployRun.runWith(answers(true))(handleDeploy);

    expect(steps[0]).toBe("funding");
    expect(PgCommand.airdrop.execute).toHaveBeenCalledWith("1");
    expect(waitForInput).not.toHaveBeenCalled();
  });

  it("stops at the funding card without requesting SOL when the stage may not airdrop", async () => {
    balance.mockResolvedValueOnce(0);

    const run = PgDeployRun.runWith(answersWithoutAirdrop(true))(handleDeploy);

    await expect(run).rejects.toMatchObject({
      detail: { reason: "airdrop_off", balance: 0, address: WALLET },
    });
    expect(PgCommand.airdrop.execute).not.toHaveBeenCalled();
    expect(waitForInput).not.toHaveBeenCalled();
  });

  it("asks in the terminal before funding a typed deploy", async () => {
    balance.mockResolvedValueOnce(0);

    await handleDeploy();

    expect(waitForInput).toHaveBeenCalledOnce();
  });

  it("stops with the reason when the stage's airdrop is refused", async () => {
    balance.mockResolvedValueOnce(0);
    vi.mocked(PgCommand.airdrop.execute).mockRejectedValueOnce(
      new Error("429 Too Many Requests")
    );

    const run = PgDeployRun.runWith(answers(true))(handleDeploy);

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
    // eslint-disable-next-line unicorn/no-null -- `PgSession.get()` is `null` when signed out
    vi.mocked(PgSession.get).mockReturnValueOnce(null as never);

    const run = PgDeployRun.runWith(answers(true))(handleDeploy);

    await expect(run).rejects.toMatchObject({
      detail: { reason: "signed_out" },
    });
    expect(PgCommand.airdrop.execute).not.toHaveBeenCalled();
  });

  it("funds a signed-out user from the local faucet on localnet", async () => {
    const { PgConnection } = await import("../../utils");
    Object.assign(PgConnection, { cluster: "localnet" });
    vi.mocked(PgConnection.getAirdropAmount).mockReturnValueOnce(100);
    balance.mockResolvedValueOnce(0);
    // eslint-disable-next-line unicorn/no-null -- `PgSession.get()` is `null` when signed out
    vi.mocked(PgSession.get).mockReturnValue(null as never);

    try {
      const run = PgDeployRun.runWith(answers(true))(handleDeploy);

      await expect(run).resolves.toMatchObject({ signature: "sig-deploy" });
      expect(PgCommand.airdrop.execute).toHaveBeenCalledWith("1");
    } finally {
      Object.assign(PgConnection, { cluster: "devnet" });
      vi.mocked(PgSession.get).mockReturnValue({ id: "u1" } as never);
    }
  });

  it("says there is no faucet where the network has none", async () => {
    balance.mockResolvedValueOnce(0);
    const { PgConnection } = await import("../../utils");
    // eslint-disable-next-line unicorn/no-null -- `getAirdropAmount()` is `null` for a network with no faucet
    vi.mocked(PgConnection.getAirdropAmount).mockReturnValueOnce(null);

    const run = PgDeployRun.runWith(answers(true))(handleDeploy);

    await expect(run).rejects.toMatchObject({
      detail: { reason: "no_faucet" },
    });
  });

  it("takes the stage's answer about a failed build, not the terminal's", async () => {
    lastBuildFailed();
    const said = answers(false);

    const run = PgDeployRun.runWith(said)(runChecks);

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

    const result = await handleDeploy();

    expect(result).toMatchObject({ signature: "sig-upgrade", upgraded: true });
    expect(upgrades).toContain(true);
  });

  it.each([
    {
      last: "deploy",
      onChain: { deployed: false, upgradable: true, programDataLen: 0 },
      signature: "sig-deploy",
    },
    {
      last: "upgrade",
      onChain: { deployed: true, upgradable: true, programDataLen: 1000 },
      signature: "sig-upgrade",
    },
  ] as const)(
    "checks the buffer through the read-buffer RPC on the way to the $last",
    async ({ last, onChain, signature }) => {
      Object.assign(PgProgramInfo, { onChain });
      const { BpfLoaderUpgradeable } = await import("./bpf-loader-upgradeable");
      let bufferExists = false;
      vi.mocked(BpfLoaderUpgradeable.createBuffer).mockImplementationOnce(
        async () => {
          bufferExists = true;
          return "sig-buffer";
        }
      );
      vi.mocked(
        last === "deploy"
          ? BpfLoaderUpgradeable.deployProgram
          : BpfLoaderUpgradeable.upgradeProgram
      ).mockImplementationOnce(async () => {
        bufferExists = false;
        return signature;
      });
      chain.readBuffer = {
        getAccountInfo: async () => (bufferExists ? {} : undefined),
      };
      chain.confirmErr = "unconfirmed";

      await expect(handleDeploy()).resolves.toMatchObject({ signature });
      expect(chain.selectedReads).toBe(0);
    }
  );

  it("goes back to no run after a failure", async () => {
    const { BpfLoaderUpgradeable } = await import("./bpf-loader-upgradeable");
    vi.mocked(BpfLoaderUpgradeable.deployProgram).mockRejectedValue(
      new Error("rpc down")
    );

    await expect(handleDeploy()).rejects.toThrow();

    expect(PgDeployRun.state.step).toBeNull();
    expect(PgDeployRun.lastStep).toBe("deploy");
    vi.mocked(BpfLoaderUpgradeable.deployProgram).mockResolvedValue(
      "sig-deploy"
    );
  });

  it("deploys the last successful build when the stage says yes", async () => {
    lastBuildFailed();
    const said = answers(true);

    await expect(PgDeployRun.runWith(said)(runChecks)).resolves.toBeUndefined();

    expect(said.confirmStaleBuild).toHaveBeenCalledOnce();
    expect(waitForInput).not.toHaveBeenCalled();
  });

  it("drops the stage's answers once its run ends, however it ends", async () => {
    await PgDeployRun.runWith(answers(true))(async () => undefined);
    expect(PgDeployRun.answers).toBeUndefined();

    await expect(
      PgDeployRun.runWith(answers(true))(async () => {
        throw new Error("failed");
      })
    ).rejects.toThrow("failed");
    expect(PgDeployRun.answers).toBeUndefined();
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
    const current = utils.PgWallet.current;
    if (!current) throw new Error("The mocked wallet has no current account");
    const standard = {
      publicKey: current.publicKey,
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
      const result = await handleDeploy();
      expect(result?.cost).toBe(500_000_000);
    } finally {
      Object.assign(utils.PgWallet, {
        current: { publicKey: standard.publicKey, isPg: true },
      });
    }
  });
});
