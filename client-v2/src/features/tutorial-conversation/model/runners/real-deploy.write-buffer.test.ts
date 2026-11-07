import { beforeEach, describe, expect, it, vi } from "vitest";

/** The selected connection and the read-buffer RPC, which alone sees the fresh buffer */
const rpc = vi.hoisted(() => ({
  selected: {
    rpcEndpoint: "https://platform.test",
    getMinimumBalanceForRentExemption: async () => 1,
    // eslint-disable-next-line unicorn/no-null -- web3's `getAccountInfo` answers `null` for no account
    getAccountInfo: vi.fn(async () => null as object | null),
  },
  readBuffer: {
    rpcEndpoint: "https://read.test",
    getAccountInfo: vi.fn(async () => ({} as object | null)),
  },
}));
const loader = vi.hoisted(() => ({
  createBuffer: vi.fn(async () => "sig-buffer"),
  loadBuffer: vi.fn<(...args: unknown[]) => Promise<undefined>>(
    async () => undefined
  ),
  closeBuffer: vi.fn(async () => "sig-close"),
}));
const println = vi.hoisted(() => vi.fn());

// The utils barrel needs build-time globals the unit runner does not define
vi.mock("../../../../utils", () => {
  const pk = { toBase58: () => "Wa11et", equals: () => true };
  return {
    PgConnection: {
      cluster: "devnet",
      current: rpc.selected,
      getReadBufferConnection: () => rpc.readBuffer,
    },
    PgProgramInfo: { pk, kp: { publicKey: pk }, uuid: "u" },
    PgWallet: {
      accounts: [{}],
      currentIndex: 0,
      create: () => ({ publicKey: pk }),
    },
    PgWeb3: {
      Keypair: {
        generate: () => ({ publicKey: { toBase58: () => "Buf1111" } }),
      },
      BpfLoaderUpgradeableProgram: { getBufferAccountSize: (n: number) => n },
      PublicKey: class {},
    },
    PgTerminal: { println },
  };
});
vi.mock("../../../../commands/deploy/bpf-loader-upgradeable", () => ({
  BpfLoaderUpgradeable: loader,
}));
// Sends once, then fails unless the send's own check passes
vi.mock("../../../../commands/deploy/deploy", () => ({
  sendAndConfirmTxWithRetriesFor:
    () =>
    async (
      send: () => Promise<string>,
      // eslint-disable-next-line layers/curry-order -- the order `sendAndConfirmTxWithRetriesFor` returns
      check: () => Promise<boolean>
    ) => {
      const signature = await send();
      if (!(await check())) throw new Error("not confirmed");
      return signature;
    },
}));
vi.mock("./real-run", () => ({
  currentTarget: () => ({
    workspace: "lumberjack",
    endpoint: "https://platform.test",
    cluster: "devnet",
  }),
  runOnDevnet: () => vi.fn(),
}));
vi.mock("./build", () => ({ runBuild: vi.fn() }));

import { realDeployPort } from "./real-deploy";

/** A port that has passed its refusal and picked its wallet, as `runDeploy` asks them */
const startedPort = () => {
  const port = realDeployPort();
  expect(port.refusal()).toBeNull();
  expect(port.wallet()).toBe("Wa11et");
  return port;
};

describe("realDeployPort().writeBuffer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks the new buffer through the read-buffer RPC and hands onWrite to loadBuffer", async () => {
    const onWrite = vi.fn();

    await startedPort().writeBuffer(
      new Uint8Array(10),
      { deployed: false },
      onWrite
    );

    expect(rpc.readBuffer.getAccountInfo).toHaveBeenCalled();
    expect(rpc.selected.getAccountInfo).not.toHaveBeenCalled();
    expect(loader.loadBuffer.mock.calls[0][2]).toMatchObject({ onWrite });
  });

  it("prints how to reclaim a buffer it could not close after a failed write", async () => {
    loader.loadBuffer.mockRejectedValueOnce(new Error("writes refused"));
    loader.closeBuffer.mockRejectedValueOnce(new Error("blockhash not found"));

    const writing = startedPort().writeBuffer(
      new Uint8Array(10),
      { deployed: false },
      vi.fn()
    );

    await expect(writing).rejects.toThrow("writes refused");
    expect(println).toHaveBeenCalledWith(
      "Its buffer Buf1111 could not be closed. Run " +
        "`solana program close --buffers -u 'https://read.test'` to reclaim its SOL."
    );
  });
});
