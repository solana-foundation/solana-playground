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
}));

// The editor's globals as the funded probe reads them: a wallet, no program
// deployed yet, and a connection that answers a balance and rent
vi.mock("@/utils", () => ({
  PgConnection: {
    get cluster() {
      return h.cluster;
    },
    current: {
      rpcEndpoint: "https://api.devnet.solana.com",
      getBalance: h.getBalance,
      getMinimumBalanceForRentExemption: h.rentRead,
    },
  },
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
beforeAll(async () => {
  tutorialRunner = (await import("./real-deploy")).tutorialRunner;
});

beforeEach(() => {
  h.cluster = "devnet";
  h.getBalance.mockReset().mockImplementation(async () => h.balance);
  h.rentRead.mockReset().mockResolvedValue(RENT);
});

describe("features/tutorial-conversation/model/runners/real-deploy: tutorialRunner.isFunded", () => {
  it.each([["localnet"], ["mainnet-beta"], [undefined]])(
    "answers false on %s without reading the chain",
    async (cluster) => {
      h.cluster = cluster;
      h.balance = 100 * SOL;
      await expect(tutorialRunner.isFunded?.()).resolves.toBe(false);
      expect(h.getBalance).not.toHaveBeenCalled();
      expect(h.rentRead).not.toHaveBeenCalled();
    }
  );

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
