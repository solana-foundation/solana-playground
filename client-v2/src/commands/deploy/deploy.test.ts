// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md)
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isStopped } from "../../utils/stopped";

/** What each test sets: the run's stop, the wallet's balance, the terminal */
const env = vi.hoisted(() => ({
  controller: new AbortController(),
  balance: 0,
  waitForInput: (async () => true) as (msg: string) => Promise<unknown>,
  executeFromStr: (async () => undefined) as (cmd: string) => Promise<unknown>,
}));
const airdrop = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn(async () => "sig"));
const loadBuffer = vi.hoisted(() => vi.fn());
const closeBuffer = vi.hoisted(() => vi.fn(async () => "sig"));

vi.mock("../../utils", () => ({
  PgCommand: { airdrop: { execute: airdrop }, build: { execute: vi.fn() } },
  PgCommon: { formatSeconds: String, makePlural: String, sleep: vi.fn() },
  PgConnection: {
    current: {
      getBalance: async () => env.balance,
      getMinimumBalanceForRentExemption: async () => 2_000_000_000,
      getAccountInfo: async () => null,
    },
    getAirdropAmount: () => 5,
  },
  PgGlobal: {
    deployState: "ready",
    update: vi.fn(),
    onDidChangeDeployState: () => ({ dispose: vi.fn() }),
  },
  PgProgramInfo: {
    importedProgram: { bytes: new Uint8Array(10) },
    onChain: { deployed: false },
    pk: {},
  },
  PgServer: { deploy: vi.fn() },
  PgTerminal: {
    bold: String,
    info: String,
    success: String,
    println: vi.fn(),
    get: async () => ({
      println: vi.fn(),
      waitForInput: (msg: string) => env.waitForInput(msg),
      executeFromStr: (cmd: string) => env.executeFromStr(cmd),
    }),
  },
  PgTx: { send, confirm: async () => ({}) },
  PgView: { setMainSecondaryProgress: vi.fn() },
  PgWallet: {
    current: { isPg: true, publicKey: {} },
    accounts: [],
    create: vi.fn(),
  },
  PgWeb3: {
    BpfLoaderUpgradeableProgram: { getBufferAccountSize: () => 10 },
    lamportsToSol: (lamports: number) => lamports / 1e9,
    solToLamports: (sol: number) => sol * 1e9,
    Keypair: {
      generate: () => ({ publicKey: { toBase58: () => "Buf1111" } }),
    },
  },
}));

vi.mock("../checks", () => ({ checkWallet: vi.fn() }));
vi.mock("../create", () => ({ createCmd: <T>(cmd: T) => cmd }));
vi.mock("./bpf-loader-upgradeable", () => ({
  BpfLoaderUpgradeable: {
    createBuffer: send,
    extendProgram: send,
    loadBuffer,
    closeBuffer,
  },
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
    env.waitForInput = async () => true;
    env.executeFromStr = async () => undefined;
    airdrop.mockClear();
    send.mockClear();
    loadBuffer.mockReset();
    closeBuffer.mockClear();
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
  });
});
