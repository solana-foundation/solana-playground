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
      clusterIsStale: false,
      hasClusterReadFailed: false,
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
    PgTerminal: { println, warning: (text: string) => `warning: ${text}` },
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

import { PgConnection } from "../../../../utils";
import { realDeployPort } from "./real-deploy";

/** A port that has passed its refusal and read its wallet and program, as `runDeploy` asks them */
const startedPort = () => {
  const port = realDeployPort();
  expect(port.refusal()).toBeNull();
  expect(port.wallet()).toBe("Wa11et");
  expect(port.program().id).toBe("Wa11et");
  return port;
};

describe("realDeployPort().refusal", () => {
  // HOO-2728: right after a switch to a custom RPC the cached name is still
  // the old network's, which may hide mainnet behind "devnet"
  it("refuses while the network's name is still the previous endpoint's", () => {
    Object.defineProperty(PgConnection, "clusterIsStale", {
      value: true,
      configurable: true,
    });
    try {
      expect(realDeployPort().refusal()).toBe(
        "The network is still loading. Try again in a moment."
      );
    } finally {
      Object.defineProperty(PgConnection, "clusterIsStale", {
        value: false,
        configurable: true,
      });
    }
  });
});

describe("realDeployPort().refusal on a failed read", () => {
  // A custom RPC that is down never stops being stale; the learner gets the
  // devnet line, not a wait that never ends
  it("says devnet when the network's read failed", () => {
    const set = (key: string, value: unknown) =>
      Object.defineProperty(PgConnection, key, { value, configurable: true });
    set("clusterIsStale", true);
    set("hasClusterReadFailed", true);
    set("cluster", undefined);
    try {
      expect(realDeployPort().refusal()).toBe(
        "Tutorials deploy to devnet. Switch the network to devnet in Settings and try again."
      );
    } finally {
      set("clusterIsStale", false);
      set("hasClusterReadFailed", false);
      set("cluster", "devnet");
    }
  });
});

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

  it("prints a refused write and a rate limit as warnings, as the Deploy stage does", async () => {
    loader.loadBuffer.mockImplementationOnce(async (...args: unknown[]) => {
      const opts = args[2] as {
        onRefusal: (message: string) => void;
        onRateLimit: (retryAfter: number, reason: string) => void;
      };
      opts.onRefusal(
        "Transaction simulation failed: Insufficient funds for fee"
      );
      opts.onRateLimit(10, "Solana RPC: Too many requests");
      return undefined;
    });

    await startedPort().writeBuffer(
      new Uint8Array(10),
      { deployed: false },
      vi.fn()
    );

    expect(println.mock.calls).toEqual([
      [
        "warning: Warning: The cluster refused a buffer write (Transaction simulation failed: Insufficient funds for fee), sending it again...",
        { noColor: true },
      ],
      [
        "warning: Warning: Reached rate-limits (Solana RPC: Too many requests), waiting 10s...",
        { noColor: true },
      ],
    ]);
  });

  it("sends on the connection the run started on after the settings switch it", async () => {
    const port = startedPort();
    const switched = {
      rpcEndpoint: "https://other.test",
      getMinimumBalanceForRentExemption: async () => 1,
      getAccountInfo: vi.fn(async () => ({} as object | null)),
    };
    const mutable = PgConnection as { current: unknown };
    mutable.current = switched;
    try {
      await port.writeBuffer(new Uint8Array(10), { deployed: false }, vi.fn());
    } finally {
      mutable.current = rpc.selected;
    }

    expect(loader.createBuffer.mock.calls[0]).toContainEqual(
      expect.objectContaining({ connection: rpc.selected })
    );
    expect(loader.loadBuffer.mock.calls[0][2]).toMatchObject({
      connection: rpc.selected,
    });
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
