// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md)
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";

import { PgTerminal } from "../../utils";
import { isStopped } from "../../utils/stopped";
import { MAINNET_DEPLOY_BLOCKED } from "./mainnet-block";
import { PgDeployRun } from "./run";

/** What each test sets: the run's stop, the wallet's balance, the terminal */
const env = vi.hoisted(() => ({
  controller: new AbortController(),
  balance: 0,
  /** The buffer account's balance, read when a stop could not close it */
  bufferBalance: (async () => 0) as () => Promise<number>,
  /** The user has switched network since the deploy began */
  switchedNetwork: false,
  /** What `PgConnection.getCluster` reads from the deploy's endpoint */
  cluster: "devnet",
  /** Runs while `getCluster` reads: the user switching network meanwhile */
  duringClusterRead: () => undefined as void,
  /** What `PgProgramInfo.onChain` holds for the selected network */
  onChain: { deployed: false } as { deployed: boolean },
  waitForInput: (async () => true) as (msg: string) => Promise<unknown>,
  executeFromStr: (async () => undefined) as (cmd: string) => Promise<unknown>,
  /** What `getAccountInfo` returns for the buffer */
  // eslint-disable-next-line unicorn/no-null -- `getAccountInfo` answers `null` for a missing account
  bufferAccount: null as { data: Buffer } | null,
  /** `getAccountInfo` fails, as a stuck RPC does */
  accountReadFails: false,
  /** The deploy is from a standard wallet, which hands SOL to the Playground one */
  standard: false,
  /** The deploy-state listener `loadBufferWithControl` registers */
  onDeployState: (() => undefined) as (state: string) => void,
  /** What the terminal handle printed: the cancel's lines */
  termLines: [] as string[],
  /** What `PgConnection.getReadBufferConnection` answers; the selected connection when unset */
  readBuffer: undefined as
    | {
        rpcEndpoint: string;
        getBalance: () => Promise<number>;
        getAccountInfo: () => Promise<{ data: Buffer } | null>;
      }
    | undefined,
}));
/** A wallet's key: its address, and the 32 bytes a buffer stores as authority */
const keyOf = vi.hoisted(() => (address: string) => ({
  toBase58: () => address,
  toBuffer: () => Buffer.alloc(32, address),
}));
const pgWallet = vi.hoisted(() => ({
  isPg: true,
  publicKey: keyOf("Pg1111"),
}));
const standardWallet = vi.hoisted(() => ({
  isPg: false,
  publicKey: keyOf("Std1111"),
}));
const airdrop = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn(async () => "sig"));
const loadBuffer = vi.hoisted(() => vi.fn());
const closeBuffer = vi.hoisted(() => vi.fn(async () => "sig"));
const deployProgram = vi.hoisted(() => vi.fn(async () => "sig"));
const createBuffer = vi.hoisted(() => vi.fn(async () => "sig"));
const setBufferAuthority = vi.hoisted(() => vi.fn(async () => "sig"));
const openBuffers = vi.hoisted(() => ({
  record: vi.fn(async () => undefined),
  forget: vi.fn(async () => undefined),
}));

vi.mock("../../utils", () => ({
  PgCommand: { airdrop: { execute: airdrop }, build: { execute: vi.fn() } },
  PgCommon: {
    formatSeconds: String,
    makePlural: String,
    sleep: vi.fn(),
    timeout: <R>(promisable: Promise<R>) => promisable,
  },
  PgConnection: {
    get current() {
      // A connection stays on the network it was taken for: on another one
      // the buffer does not exist, and its balance reads 0
      const switched = env.switchedNetwork;
      return {
        // The buffer's key is `Keypair.generate`'s; any other is the wallet's
        getBalance: async (key: { toBase58: () => string }) => {
          if (key.toBase58() !== "Buf1111") return env.balance;
          return switched ? 0 : env.bufferBalance();
        },
        rpcEndpoint: "https://api.devnet.solana.com",
        getMinimumBalanceForRentExemption: async () => 2_000_000_000,
        getAccountInfo: async () => {
          if (env.accountReadFails) throw new Error("fetch failed");
          return env.bufferAccount;
        },
      };
    },
    getAirdropAmount: () => 5,
    getCluster: async () => {
      env.duringClusterRead();
      return env.cluster;
    },
    getReadBufferConnection: <T>(connection: T) => env.readBuffer ?? connection,
  },
  PgGlobal: {
    deployState: "ready",
    update: vi.fn(),
    onDidChangeDeployState: (listener: (state: string) => void) => {
      env.onDeployState = listener;
      return { dispose: vi.fn() };
    },
  },
  PgProgramInfo: {
    importedProgram: { bytes: new Uint8Array(10) },
    get onChain() {
      return env.onChain;
    },
    pk: {},
  },
  PgServer: { deploy: vi.fn() },
  PgTerminal: {
    bold: String,
    info: String,
    success: String,
    error: String,
    warning: String,
    println: vi.fn(),
    get: async () => ({
      println: (line: string) => env.termLines.push(line),
      waitForInput: (msg: string) => env.waitForInput(msg),
      executeFromStr: (cmd: string) => env.executeFromStr(cmd),
    }),
  },
  PgTx: { send, confirm: async () => ({}) },
  TerminalLineError: class TerminalLineError extends Error {},
  PgView: { setMainSecondaryProgress: vi.fn() },
  PgWallet: {
    get current() {
      return env.standard ? standardWallet : pgWallet;
    },
    accounts: [],
    create: () => pgWallet,
    balance: 100,
  },
  PgWeb3: {
    BpfLoaderUpgradeableProgram: { getBufferAccountSize: () => 10 },
    lamportsToSol: (lamports: number) => lamports / 1e9,
    solToLamports: (sol: number) => sol * 1e9,
    Keypair: {
      generate: () => ({ publicKey: { toBase58: () => "Buf1111" } }),
    },
    SystemProgram: { transfer: vi.fn() },
  },
}));

vi.mock("../checks", () => ({ checkWallet: vi.fn() }));
vi.mock("../create", () => ({ createCmd: <T>(cmd: T) => cmd }));
vi.mock("./bpf-loader-upgradeable", () => ({
  BpfLoaderUpgradeable: {
    createBuffer,
    extendProgram: send,
    loadBuffer,
    closeBuffer,
    deployProgram,
    setBufferAuthority,
  },
}));
vi.mock("./open-buffers", () => ({
  recordOpenBuffer: openBuffers.record,
  forgetOpenBuffer: openBuffers.forget,
}));

/** Run the deploy command's handler and return what it ended with */
const runDeploy = async () => {
  const { deploy } = await import("./deploy");
  return (
    deploy as unknown as {
      handle: (input: {
        signal: AbortSignal;
        lockStop: () => void;
      }) => Promise<unknown>;
    }
  )
    .handle({ signal: env.controller.signal, lockStop: vi.fn() })
    .catch((e: unknown) => e);
};

describe("commands/deploy", () => {
  beforeEach(() => {
    env.controller = new AbortController();
    env.balance = 0;
    env.bufferBalance = async () => 0;
    env.switchedNetwork = false;
    env.cluster = "devnet";
    env.duringClusterRead = () => undefined;
    env.onChain = { deployed: false };
    env.waitForInput = async () => true;
    env.executeFromStr = async () => undefined;
    // A live buffer whose authority is the Playground wallet
    env.bufferAccount = {
      data: Buffer.concat([Buffer.alloc(5), pgWallet.publicKey.toBuffer()]),
    };
    env.accountReadFails = false;
    env.standard = false;
    env.termLines = [];
    env.readBuffer = undefined;
    airdrop.mockClear();
    send.mockClear();
    loadBuffer.mockReset();
    closeBuffer.mockReset();
    closeBuffer.mockImplementation(async () => "sig");
    deployProgram.mockReset();
    deployProgram.mockImplementation(async () => "sig");
    createBuffer.mockReset();
    createBuffer.mockImplementation(async () => "sig");
    setBufferAuthority.mockReset();
    setBufferAuthority.mockImplementation(async () => "sig");
    openBuffers.record.mockClear();
    openBuffers.forget.mockReset();
    openBuffers.forget.mockImplementation(async () => undefined);
    vi.mocked(PgTerminal.println).mockClear();
  });

  // HOO-2728: the network can move to mainnet while the pre-checks' wallet
  // question waits, so the run reads its own connection again before a send
  it("refuses before any send when its connection is on mainnet", async () => {
    env.cluster = "mainnet-beta";
    env.balance = 100e9;

    const failure = await runDeploy();

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(MAINNET_DEPLOY_BLOCKED);
    expect(airdrop).not.toHaveBeenCalled();
    expect(createBuffer).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  // The network read waits on the RPC; a switch meanwhile refreshes the
  // program info for the other network, which must not pick deploy or upgrade
  it("deploys as the program info read with its connection, not after a switch", async () => {
    env.balance = 100e9;
    env.duringClusterRead = () => {
      env.onChain = { deployed: true };
    };

    await runDeploy();

    expect(deployProgram).toHaveBeenCalled();
  });

  it("asks for nothing more once stopped during the airdrop question", async () => {
    // The person presses Stop while the question waits, then answers yes
    env.waitForInput = async () => {
      env.controller.abort();
      return true;
    };

    const failure = await runDeploy();

    expect(isStopped(failure)).toBe(true);
    expect(airdrop).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("answers the airdrop question no when stopped, without waiting for the person", async () => {
    let answer: (value: boolean) => void = () => undefined;
    env.waitForInput = () =>
      new Promise((res) => {
        answer = res;
        env.controller.abort();
      });
    const executed: string[] = [];
    env.executeFromStr = async (cmd) => {
      executed.push(cmd);
      answer(cmd === "yes");
    };

    const failure = await runDeploy();

    expect(executed).toEqual(["no"]);
    expect(isStopped(failure)).toBe(true);
    expect(airdrop).not.toHaveBeenCalled();
  });

  /** What the terminal printed during the run, one string per line */
  const printed = () =>
    vi.mocked(PgTerminal.println).mock.calls.map(([line]) => String(line));

  it("closes the buffer when the load fails after a stop", async () => {
    env.balance = 10_000_000_000;
    loadBuffer.mockImplementation(async () => {
      env.controller.abort();
      throw new Error("the segment was aborted");
    });

    const failure = await runDeploy();

    expect(isStopped(failure)).toBe(true);
    expect(closeBuffer).toHaveBeenCalledTimes(1);
    expect((failure as Error).message).toContain("buffer account was closed");
    expect(openBuffers.forget).toHaveBeenCalledWith("Buf1111");
  });

  /** A load that fails without a stop */
  const failTheLoad = () => {
    env.balance = 10_000_000_000;
    loadBuffer.mockImplementation(async () => {
      throw new Error("The RPC kept refusing buffer writes");
    });
  };

  it("closes the buffer without asking when the Deploy stage's load fails", async () => {
    failTheLoad();
    const asked = vi.fn(async () => true);
    env.waitForInput = asked;

    const failure = await PgDeployRun.runWith({
      confirmStaleBuild: async () => true,
      airdrop: true,
    })(runDeploy);

    expect(asked).not.toHaveBeenCalled();
    expect(closeBuffer).toHaveBeenCalledTimes(1);
    expect((failure as Error).message).toBe(
      "The RPC kept refusing buffer writes"
    );
  });

  it("names the buffer and the close command, and reports, when the Deploy stage's close fails", async () => {
    failTheLoad();
    closeBuffer.mockImplementation(async () => {
      throw new Error("blockhash not found");
    });
    env.readBuffer = {
      rpcEndpoint: "https://read.test",
      getBalance: async () => 1_421_676_960,
      getAccountInfo: async () => env.bufferAccount,
    };
    const logged = memoryProvider();
    initLogger({ providers: [logged] });

    try {
      const failure = await PgDeployRun.runWith({
        confirmStaleBuild: async () => true,
        airdrop: true,
      })(runDeploy);

      expect((failure as Error).message).toBe(
        "The RPC kept refusing buffer writes Its buffer Buf1111 still holds " +
          "1.42 SOL. Run `solana program close --buffers -u 'https://read.test'` " +
          "to get it back."
      );
      expect(
        logged.entries.some(
          (entry) => entry.report && entry.context?.buffer === "Buf1111"
        )
      ).toBe(true);
    } finally {
      resetLogger();
    }
  });

  it("answers the reclaim question no when stopped, without waiting for the person", async () => {
    failTheLoad();
    let answer: (value: boolean) => void = () => undefined;
    env.waitForInput = (msg) =>
      new Promise((res) => {
        if (!msg.includes("reclaim SOL")) return res(true);
        answer = res;
        env.controller.abort();
      });
    const executed: string[] = [];
    env.executeFromStr = async (cmd) => {
      executed.push(cmd);
      answer(cmd === "yes");
    };

    await runDeploy();

    expect(executed).toEqual(["no"]);
    expect(closeBuffer).not.toHaveBeenCalled();
  });

  it("reads a kept buffer's balance through the read-buffer RPC", async () => {
    stopKeepingTheBuffer();
    // The selected connection reads the fresh buffer as empty, as the platform RPC does
    env.bufferBalance = async () => 0;
    env.readBuffer = {
      rpcEndpoint: "https://read.test",
      getBalance: async () => 1_421_676_960,
      getAccountInfo: async () => env.bufferAccount,
    };

    const failure = await runDeploy();

    expect((failure as Error).message).toContain(
      "Its buffer Buf1111 still holds 1.42 SOL. Run " +
        "`solana program close --buffers -u 'https://read.test'`"
    );
  });

  /** A stop whose buffer close fails every retry, so the buffer is kept */
  const stopKeepingTheBuffer = () => {
    env.balance = 10_000_000_000;
    loadBuffer.mockImplementation(async () => {
      env.controller.abort();
      throw new Error("the segment was aborted");
    });
    closeBuffer.mockImplementation(async () => {
      throw new Error("blockhash not found");
    });
  };

  it("names the SOL a buffer it could not close still holds", async () => {
    stopKeepingTheBuffer();
    env.bufferBalance = async () => 1_421_676_960;

    const failure = await runDeploy();

    expect(isStopped(failure)).toBe(true);
    expect((failure as Error).message).toContain(
      "Its buffer Buf1111 still holds 1.42 SOL."
    );
    // The stop settled it: the failure close does not try again
    expect(closeBuffer).toHaveBeenCalledTimes(5);
    expect(openBuffers.forget).not.toHaveBeenCalled();
    expect(printed().join("\n")).not.toContain("Buf1111");
  });

  it("reads a kept buffer on the deploy's network, not one chosen since", async () => {
    stopKeepingTheBuffer();
    env.bufferBalance = async () => 1_421_676_960;
    closeBuffer.mockImplementation(async () => {
      env.switchedNetwork = true;
      throw new Error("blockhash not found");
    });

    const failure = await runDeploy();

    expect((failure as Error).message).toContain(
      "Its buffer Buf1111 still holds 1.42 SOL."
    );
  });

  it('keeps "its SOL" when the kept buffer\'s balance cannot be read', async () => {
    stopKeepingTheBuffer();
    env.bufferBalance = async () => {
      throw new Error("429 Too Many Requests");
    };

    const failure = await runDeploy();

    expect(isStopped(failure)).toBe(true);
    expect((failure as Error).message).toContain(
      "Its buffer Buf1111 still holds its SOL."
    );
  });

  it("calls a buffer that reads empty closed: the close landed unconfirmed", async () => {
    stopKeepingTheBuffer();
    // A missing account's balance is 0; a live buffer is rent-exempt
    env.bufferBalance = async () => 0;

    const failure = await runDeploy();

    expect(isStopped(failure)).toBe(true);
    expect((failure as Error).message).toContain("buffer account was closed");
  });

  // A failure after `createBuffer` used to leave the buffer open, its address
  // nowhere, and its rent stranded
  describe("a deploy that fails after its buffer is created", () => {
    it("records the buffer before creating it", async () => {
      env.balance = 10_000_000_000;
      loadBuffer.mockResolvedValue(undefined);

      await runDeploy();

      expect(openBuffers.record).toHaveBeenCalledWith({
        address: "Buf1111",
        authority: "Pg1111",
        endpoint: "https://api.devnet.solana.com",
        cluster: "devnet",
        at: expect.any(String),
      });
      expect(openBuffers.record.mock.invocationCallOrder[0]).toBeLessThan(
        createBuffer.mock.invocationCallOrder[0]
      );
      // The deploy consumed it
      expect(openBuffers.forget).toHaveBeenCalledWith("Buf1111");
    });

    it("closes the buffer on a yes when the load fails, then fails with the load's error", async () => {
      env.balance = 10_000_000_000;
      loadBuffer.mockRejectedValue(new Error("write transaction dropped"));

      const failure = await runDeploy();

      expect((failure as Error).message).toBe("write transaction dropped");
      expect(isStopped(failure)).toBe(false);
      expect(closeBuffer).toHaveBeenCalledTimes(1);
      expect(env.termLines).toContain("Reclaim successful.");
      expect(openBuffers.forget).toHaveBeenCalledWith("Buf1111");
    });

    it("keeps the buffer and its record on a no after a failed load", async () => {
      env.balance = 10_000_000_000;
      loadBuffer.mockRejectedValue(new Error("write transaction dropped"));
      env.waitForInput = async () => false;

      await runDeploy();

      expect(closeBuffer).not.toHaveBeenCalled();
      expect(openBuffers.forget).not.toHaveBeenCalled();
      expect(env.termLines.join("\n")).toContain("Reclaim rejected.");
    });

    it("closes the buffer when the deploy transaction fails", async () => {
      env.balance = 10_000_000_000;
      loadBuffer.mockResolvedValue(undefined);
      deployProgram.mockRejectedValue(new Error("program deploy failed"));

      const failure = await runDeploy();

      expect((failure as Error).message).toContain("program deploy failed");
      expect(closeBuffer).toHaveBeenCalledTimes(1);
    });

    it("keeps the record and names the buffer when its close fails", async () => {
      env.balance = 10_000_000_000;
      env.bufferBalance = async () => 1_421_676_960;
      loadBuffer.mockRejectedValue(new Error("write transaction dropped"));
      closeBuffer.mockRejectedValue(new Error("blockhash not found"));

      const failure = await runDeploy();

      expect((failure as Error).message).toContain("write transaction dropped");
      expect(env.termLines.join("\n")).toContain(
        "Its buffer Buf1111 still holds 1.42 SOL."
      );
      expect(openBuffers.forget).not.toHaveBeenCalled();
    });

    it("says a buffer that reads empty after a failed close may have deployed", async () => {
      env.balance = 10_000_000_000;
      loadBuffer.mockResolvedValue(undefined);
      deployProgram.mockRejectedValue(new Error("program deploy failed"));
      closeBuffer.mockRejectedValue(new Error("account not found"));
      env.bufferBalance = async () => 0;

      await runDeploy();

      expect(printed().join("\n")).toContain(
        "no longer exists; check whether the program was deployed"
      );
      expect(openBuffers.forget).toHaveBeenCalledWith("Buf1111");
    });

    it("rethrows the deploy's error when settling the buffer fails", async () => {
      env.balance = 10_000_000_000;
      loadBuffer.mockRejectedValue(new Error("write transaction dropped"));
      openBuffers.forget.mockRejectedValue(new Error("IndexedDB is gone"));

      const failure = await runDeploy();

      expect((failure as Error).message).toContain("write transaction dropped");
    });

    it("closes nothing and keeps the record when the create made no account", async () => {
      env.balance = 10_000_000_000;
      createBuffer.mockRejectedValue(new Error("blockhash not found"));
      // eslint-disable-next-line unicorn/no-null -- `getAccountInfo` answers `null` for a missing account
      env.bufferAccount = null;

      const failure = await runDeploy();

      expect((failure as Error).message).toContain("Exceeded maximum");
      expect(closeBuffer).not.toHaveBeenCalled();
      expect(openBuffers.forget).not.toHaveBeenCalled();
      expect(printed().join("\n")).not.toContain("buffer");
    });

    it("closes a buffer a failed create still made", async () => {
      env.balance = 10_000_000_000;
      createBuffer.mockRejectedValue(new Error("blockhash not found"));

      await runDeploy();

      expect(closeBuffer).toHaveBeenCalledTimes(1);
    });

    it("names a buffer it cannot read after a failed create, and sends no close", async () => {
      env.balance = 10_000_000_000;
      createBuffer.mockRejectedValue(new Error("blockhash not found"));
      env.accountReadFails = true;

      await runDeploy();

      expect(closeBuffer).not.toHaveBeenCalled();
      expect(openBuffers.forget).not.toHaveBeenCalled();
      expect(printed().join("\n")).toContain(
        "Could not check whether its buffer Buf1111 was created."
      );
    });

    it("sends no close for a created buffer already gone", async () => {
      env.balance = 10_000_000_000;
      loadBuffer.mockResolvedValue(undefined);
      // The deploy landed and consumed it; only its confirmation failed
      deployProgram.mockImplementation(async () => {
        // eslint-disable-next-line unicorn/no-null -- `getAccountInfo` answers `null` for a missing account
        env.bufferAccount = null;
        throw new Error("confirmation timed out");
      });

      await runDeploy();

      expect(closeBuffer).not.toHaveBeenCalled();
      expect(printed().join("\n")).toContain("no longer exists");
      expect(openBuffers.forget).toHaveBeenCalledWith("Buf1111");
    });

    it("closes with the Playground wallet when the hand-over never landed", async () => {
      env.standard = true;
      env.balance = 10_000_000_000;
      loadBuffer.mockResolvedValue(undefined);
      setBufferAuthority.mockRejectedValue(new Error("blockhash not found"));

      await runDeploy();

      expect(closeBuffer).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ wallet: pgWallet })
      );
      expect(openBuffers.record).toHaveBeenCalledTimes(1);
    });

    it("closes with the standard wallet once the buffer names it, and records it", async () => {
      env.standard = true;
      env.balance = 10_000_000_000;
      loadBuffer.mockResolvedValue(undefined);
      // The hand-over lands, but every confirmation of it fails
      setBufferAuthority.mockRejectedValue(new Error("confirmation timed out"));
      env.bufferAccount = {
        data: Buffer.concat([
          Buffer.alloc(5),
          standardWallet.publicKey.toBuffer(),
        ]),
      };

      await runDeploy();

      expect(closeBuffer).toHaveBeenCalledTimes(1);
      expect(closeBuffer).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ wallet: standardWallet })
      );
      expect(openBuffers.record).toHaveBeenLastCalledWith(
        expect.objectContaining({ address: "Buf1111", authority: "Std1111" })
      );
    });
  });

  describe("a cancelled deploy", () => {
    /** Pause during the write, answer "Continue deployment?" no, then `reclaim` */
    const cancelWith = (reclaim: boolean) => {
      env.balance = 10_000_000_000;
      loadBuffer.mockImplementation(async () => env.onDeployState("paused"));
      env.waitForInput = async (msg) =>
        msg.includes("Continue deployment?") ? false : reclaim;
    };

    it("closes the buffer on yes", async () => {
      cancelWith(true);

      const failure = await runDeploy();

      expect((failure as Error).message).toBe("Deployment cancelled");
      expect(closeBuffer).toHaveBeenCalledTimes(1);
      expect(env.termLines).toContain("Reclaim successful.");
      expect(openBuffers.forget).toHaveBeenCalledWith("Buf1111");
    });

    it("names the buffer when the close on yes fails", async () => {
      cancelWith(true);
      closeBuffer.mockRejectedValue(new Error("blockhash not found"));
      env.bufferBalance = async () => 1_421_676_960;

      await runDeploy();

      expect(env.termLines.join("\n")).toContain(
        "Its buffer Buf1111 still holds 1.42 SOL."
      );
      expect(openBuffers.forget).not.toHaveBeenCalled();
    });

    it("calls a buffer that reads empty after a failed close reclaimed", async () => {
      cancelWith(true);
      closeBuffer.mockRejectedValue(new Error("blockhash not found"));
      env.bufferBalance = async () => 0;

      await runDeploy();

      expect(env.termLines).toContain("Reclaim successful.");
    });

    it("keeps the buffer and its record on no", async () => {
      cancelWith(false);

      const failure = await runDeploy();

      expect((failure as Error).message).toBe("Deployment cancelled");
      expect(closeBuffer).not.toHaveBeenCalled();
      expect(openBuffers.forget).not.toHaveBeenCalled();
    });
  });
});
