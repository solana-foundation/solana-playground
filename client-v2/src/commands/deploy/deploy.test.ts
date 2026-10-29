// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md)
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isStopped } from "../../utils/stopped";

const run = vi.hoisted(() => ({ controller: new AbortController() }));
const airdrop = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());

vi.mock("../../utils", () => ({
  PgCommand: { airdrop: { execute: airdrop }, build: { execute: vi.fn() } },
  PgCommon: { formatSeconds: String, makePlural: String },
  PgConnection: {
    current: {
      getBalance: async () => 0,
      getMinimumBalanceForRentExemption: async () => 2_000_000_000,
      getAccountInfo: async () => null,
    },
    getAirdropAmount: () => 5,
  },
  PgGlobal: { deployState: "ready", update: vi.fn() },
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
      // The person presses Stop while the question waits, then answers yes
      waitForInput: async () => {
        run.controller.abort();
        return true;
      },
    }),
  },
  PgTx: { send },
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
    Keypair: { generate: vi.fn() },
  },
}));

vi.mock("../checks", () => ({ checkWallet: vi.fn() }));
vi.mock("../create", () => ({ createCmd: <T>(cmd: T) => cmd }));
vi.mock("./bpf-loader-upgradeable", () => ({
  BpfLoaderUpgradeable: { createBuffer: send, extendProgram: send },
}));

describe("commands/deploy", () => {
  beforeEach(() => {
    run.controller = new AbortController();
    airdrop.mockClear();
    send.mockClear();
  });

  it("asks for nothing more once stopped during the airdrop question", async () => {
    const { deploy } = await import("./deploy");

    const failure = await (
      deploy as unknown as {
        handle: (input: {
          signal: AbortSignal;
          lockStop: () => void;
        }) => Promise<unknown>;
      }
    )
      .handle({ signal: run.controller.signal, lockStop: vi.fn() })
      .catch((e: unknown) => e);

    expect(isStopped(failure)).toBe(true);
    expect(airdrop).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
