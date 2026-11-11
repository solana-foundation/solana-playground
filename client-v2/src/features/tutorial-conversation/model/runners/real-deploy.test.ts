import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SOL = 1_000_000_000;
const WALLET = "Wa11et1111111111111111111111111111111111111";
/** What every rent read answers, buffer and program alike */
const RENT = 0.5 * SOL;

const h = vi.hoisted(() => ({
  cluster: "devnet" as string | undefined,
  balance: 0,
  getBalance: vi.fn(),
  rentRead: vi.fn(),
  requestAirdrop: vi.fn(),
  confirm: vi.fn(),
  /** The native RPC's balance read, which funding never asks */
  nativeGetBalance: vi.fn(),
}));

/** The cluster's native RPC, which airdrops go through */
const native = vi.hoisted(() => ({
  rpcEndpoint: "https://native.test",
  getBalance: (...args: unknown[]) => h.nativeGetBalance(...args),
  requestAirdrop: (...args: unknown[]) => h.requestAirdrop(...args),
}));

// The editor's globals as the funded probe reads them: a wallet, no program
// deployed yet, and a connection that answers a balance and rent
vi.mock("@/utils", () => ({
  PgConnection: {
    get cluster() {
      return h.cluster;
    },
    current: {
      rpcEndpoint: "https://platform.test",
      getBalance: h.getBalance,
      requestAirdrop: () => {
        throw new Error("500 : internal error: please contact Helius support");
      },
      getMinimumBalanceForRentExemption: h.rentRead,
    },
    getAirdropConnection: () => native,
  },
  PgTx: { confirm: h.confirm },
  PgWallet: {
    accounts: [{}],
    currentIndex: 0,
    create: () => ({ publicKey: { toBase58: () => WALLET } }),
  },
  PgProgramInfo: { pk: undefined, kp: undefined, uuid: "build-uuid" },
  PgExplorer: { currentWorkspaceName: "Hello Anchor", files: {} },
  PgWeb3: {
    PublicKey: class {
      constructor(readonly address: string) {}
    },
    BpfLoaderUpgradeableProgram: {
      getBufferAccountSize: (length: number) => length + 37,
      PROGRAM_ACCOUNT_SIZE: 36,
    },
  },
}));

// Never reached by the probe; mocked so the module loads without the app's
// globals and the WASM packages
vi.mock("@/commands/deploy/deploy", () => ({
  sendAndConfirmTxWithRetries: vi.fn(),
}));
vi.mock("@/utils/program-interaction/instruction", () => ({
  createGeneratableInstruction: vi.fn(),
}));
vi.mock("@/utils/sign-in-refusal", () => ({
  isSignInRefusalError: () => false,
}));
vi.mock("@/views/sidebar/assistant/bridge/build-output", () => ({
  PgBuildOutput: {},
  stripKnownNoise: (s: string) => s,
}));
vi.mock("@/views/flow/stages/build-report", () => ({}));

let tutorialRunner: typeof import("./real-deploy").tutorialRunner;
let devnetFunding: typeof import("./real-deploy").devnetFunding;
beforeAll(async () => {
  ({ tutorialRunner, devnetFunding } = await import("./real-deploy"));
});

beforeEach(() => {
  h.cluster = "devnet";
  h.getBalance.mockReset().mockImplementation(async () => h.balance);
  h.rentRead.mockReset().mockResolvedValue(RENT);
  h.requestAirdrop.mockReset().mockResolvedValue("airdropSig");
  h.confirm.mockReset().mockResolvedValue(undefined);
  h.nativeGetBalance.mockReset();
});

describe("features/tutorial-conversation/model/runners/real-deploy: tutorialRunner.isFunded", () => {
  it("answers false while the cluster is unknown, without reading the chain", async () => {
    h.cluster = undefined;
    h.balance = 100 * SOL;
    await expect(tutorialRunner.isFunded?.()).resolves.toBe(false);
    expect(h.getBalance).not.toHaveBeenCalled();
    expect(h.rentRead).not.toHaveBeenCalled();
  });

  it("off devnet, answers true for a wallet that covers the deploy, so the airdrop card passes", async () => {
    h.cluster = "localnet";
    h.balance = 100 * SOL;
    await expect(tutorialRunner.isFunded?.()).resolves.toBe(true);
    expect(h.getBalance).toHaveBeenCalled();
  });

  it("on devnet, answers true for a wallet that covers the deploy", async () => {
    h.balance = 5 * SOL;
    await expect(tutorialRunner.isFunded?.()).resolves.toBe(true);
    expect(h.getBalance).toHaveBeenCalledWith(
      expect.objectContaining({ address: WALLET })
    );
  });

  it("on devnet, answers false for a wallet short of the deploy", async () => {
    h.balance = 0.1 * SOL;
    await expect(tutorialRunner.isFunded?.()).resolves.toBe(false);
  });

  it("on devnet, rejects when the chain cannot be read, for the store to handle", async () => {
    h.getBalance.mockRejectedValue(new Error("fetch failed"));
    await expect(tutorialRunner.isFunded?.()).rejects.toThrow("fetch failed");
  });
});

describe("features/tutorial-conversation/model/runners/real-deploy: devnetFunding", () => {
  it("reads the balance through the selected connection, which the deploy spends on", async () => {
    h.balance = 2 * SOL;
    await expect(devnetFunding.balance(WALLET)).resolves.toBe(2 * SOL);
    expect(h.nativeGetBalance).not.toHaveBeenCalled();
  });

  it("requests the airdrop through the cluster's native RPC", async () => {
    await expect(devnetFunding.airdrop(WALLET, SOL)).resolves.toBe(
      "airdropSig"
    );
    expect(h.requestAirdrop).toHaveBeenCalledWith(
      expect.objectContaining({ address: WALLET }),
      SOL
    );
  });

  it("confirms on the RPC that took the airdrop, and counts no error as confirmed", async () => {
    await expect(devnetFunding.confirm("airdropSig")).resolves.toBe(true);
    expect(h.confirm).toHaveBeenCalledWith("airdropSig", {
      connection: native,
    });
  });

  it("counts a confirmation that timed out as not confirmed", async () => {
    h.confirm.mockRejectedValueOnce(
      new Error("TransactionExpiredTimeoutError")
    );
    await expect(devnetFunding.confirm("airdropSig")).resolves.toBe(false);
  });

  it("counts a transaction error as not confirmed", async () => {
    h.confirm.mockResolvedValueOnce({ err: "InstructionError" });
    await expect(devnetFunding.confirm("airdropSig")).resolves.toBe(false);
  });
});
