import { beforeEach, describe, expect, it, vi } from "vitest";

// The utils barrel needs build-time globals the unit runner does not define.
// `batchChanges` and `executeInOrder` are replaced by the callback itself, so
// calling the effect's return value runs one pass.
const unmounted = vi.hoisted(() => new Error("The terminal is not open."));
vi.mock("../../utils", () => ({
  PgCommand: {
    airdrop: { execute: vi.fn() },
    setting: { name: "settings" },
  },
  PgCommon: {
    batchChanges: (cb: () => unknown) => cb,
    executeInOrder: (cb: () => unknown) => cb,
  },
  PgConnection: {
    cluster: "devnet",
    current: { rpcEndpoint: "https://api.devnet.solana.com" },
    getAirdropAmount: () => 5,
    getAirdropConnection: <T>(connection: T) => connection,
  },
  PgSettings: { wallet: { automaticAirdrop: true } },
  PgTerminal: { println: vi.fn(), error: (text: string) => text },
  PgWallet: {
    balance: 0,
    current: { publicKey: { toBase58: () => "Wa11et" } },
  },
  isTerminalUnmounted: (error: unknown) => error === unmounted,
}));
vi.mock("../../features/auth", () => ({
  PgSession: { get: vi.fn(() => ({ user: {} })) },
}));

import { getAirdropVia } from "../../commands/airdrop/via";
import { PgSession } from "../../features/auth";
import { PgCommand, PgConnection, PgTerminal } from "../../utils";
import { automaticAirdrop } from "./automatic-airdrop";

const airdrop = vi.mocked(PgCommand.airdrop.execute);
const println = vi.mocked(PgTerminal.println);
const pass = automaticAirdrop() as unknown as () => Promise<void>;

describe("automaticAirdrop", () => {
  beforeEach(() => {
    airdrop.mockReset();
  });

  // Home mounts no terminal, so the airdrop cannot run there; that must not
  // turn it off for the rest of the session
  it("tries again once a terminal was missing", async () => {
    (PgConnection as { cluster: string }).cluster = "localnet";
    airdrop.mockRejectedValueOnce(unmounted);
    await pass();

    let via = "";
    airdrop.mockImplementationOnce(async () => {
      via = getAirdropVia();
    });
    await pass();

    expect(airdrop).toHaveBeenCalledTimes(2);
    // `fund_airdropped` counts the run as the effect's, and only while it runs
    expect(via).toBe("automatic");
    expect(getAirdropVia()).toBe("terminal");
  });

  it("stops on a cluster whose airdrop failed", async () => {
    (PgConnection as { cluster: string }).cluster = "testnet";
    airdrop.mockRejectedValueOnce(new Error("rate limited"));
    await pass();
    await pass();

    expect(airdrop).toHaveBeenCalledTimes(1);
  });

  // A custom RPC's cluster takes a round trip to read. Until it answers the
  // cached name is the previous endpoint's, and Localnet's would send a
  // signed-out user's 100 SOL request to whatever the new RPC is
  it("waits while the cluster is the previous endpoint's", async () => {
    (PgConnection as { cluster: string }).cluster = "localnet";
    (PgConnection as { clusterIsStale?: boolean }).clusterIsStale = true;
    await pass();
    (PgConnection as { clusterIsStale?: boolean }).clusterIsStale = false;

    expect(airdrop).not.toHaveBeenCalled();
  });

  // The local validator's faucet asks for no sign-in (`isAirdropSignInGated`)
  it("airdrops a signed-out user on localnet", async () => {
    (PgConnection as { cluster: string }).cluster = "localnet";
    // eslint-disable-next-line unicorn/no-null -- `PgSession.get()` is `null` when signed out
    vi.mocked(PgSession.get).mockReturnValueOnce(null as never);
    airdrop.mockResolvedValueOnce(undefined);
    await pass();

    expect(airdrop).toHaveBeenCalledOnce();
  });

  it("skips a signed-out user on devnet", async () => {
    (PgConnection as { cluster: string }).cluster = "devnet";
    // eslint-disable-next-line unicorn/no-null -- `PgSession.get()` is `null` when signed out
    vi.mocked(PgSession.get).mockReturnValueOnce(null as never);
    await pass();

    expect(airdrop).not.toHaveBeenCalled();
  });

  it("points to the faucet's site, with the wallet's address, when an airdrop on devnet fails", async () => {
    (PgConnection as { cluster: string }).cluster = "devnet";
    println.mockClear();
    airdrop.mockRejectedValueOnce(new Error("Too many airdrop requests"));
    await pass();

    expect(println).toHaveBeenCalledWith(
      expect.stringContaining(
        "Visit https://faucet.solana.com/?walletAddress=Wa11et&cluster=devnet to obtain SOL."
      )
    );
  });

  it("names no faucet site for a local validator", async () => {
    (PgConnection as { cluster: string }).cluster = "localnet";
    println.mockClear();
    airdrop.mockRejectedValueOnce(new Error("connection refused"));
    await pass();

    const note = String(println.mock.calls.at(-1)?.[0]);
    expect(note).toContain("automatic airdrop request");
    expect(note).not.toContain("faucet.solana.com");
  });

  // The cache of clusters whose airdrop failed lives for the module, and the
  // tests above leave devnet in it: these load the effect afresh
  describe("once the faucet answered closed", () => {
    const DEVNET_RPC = "https://api.devnet.solana.com";
    const LINE =
      "The devnet RPC faucet is closed. Request test SOL at https://faucet.solana.com/?walletAddress=Wa11et&cluster=devnet";
    let fresh: {
      pass: () => Promise<void>;
      airdrop: ReturnType<typeof vi.fn>;
      println: ReturnType<typeof vi.fn>;
      closed: typeof import("../../commands/airdrop/closed-faucet");
    };

    beforeEach(async () => {
      vi.resetModules();
      const utils = await import("../../utils");
      const effect = await import("./automatic-airdrop");
      (utils.PgConnection as { cluster: string }).cluster = "devnet";
      fresh = {
        pass: effect.automaticAirdrop() as unknown as () => Promise<void>,
        airdrop: vi.mocked(utils.PgCommand.airdrop.execute),
        println: vi.mocked(utils.PgTerminal.println),
        closed: await import("../../commands/airdrop/closed-faucet"),
      };
    });

    it("points to the web faucet without asking the faucet, once", async () => {
      fresh.closed.rememberFaucetClosed(DEVNET_RPC);
      await fresh.pass();
      await fresh.pass();

      expect(fresh.airdrop).not.toHaveBeenCalled();
      const lines = fresh.println.mock.calls.map(([line]) => String(line));
      expect(lines).toEqual([
        LINE,
        "Note: This was an automatic airdrop request. To disable, run `settings set wallet.automaticAirdrop false`.",
      ]);
    });

    it("still asks a faucet on another endpoint, such as a local validator", async () => {
      fresh.closed.rememberFaucetClosed(DEVNET_RPC);
      const utils = await import("../../utils");
      const connection = utils.PgConnection as unknown as {
        cluster: string;
        current: { rpcEndpoint: string };
      };
      connection.cluster = "localnet";
      connection.current = { rpcEndpoint: "http://localhost:8899" };
      try {
        await fresh.pass();
      } finally {
        connection.current = { rpcEndpoint: DEVNET_RPC };
      }

      expect(fresh.airdrop).toHaveBeenCalledOnce();
    });

    it("adds no second faucet link to the note when its own airdrop found the faucet closed", async () => {
      fresh.airdrop.mockImplementationOnce(async () => {
        fresh.closed.rememberFaucetClosed(DEVNET_RPC);
        throw new Error(LINE);
      });
      const logger = await import("@/shared/lib/logger");
      const logged = logger.memoryProvider();
      logger.initLogger({ providers: [logged] });
      // The logger hands a new provider what it kept from before
      const earlier = logged.entries.length;
      try {
        await fresh.pass();
      } finally {
        logger.resetLogger();
      }

      // The log names the reason, never the line with the wallet's address
      const entries = logged.entries.slice(earlier);
      expect(entries).toEqual([
        expect.objectContaining({
          level: "warn",
          context: { cluster: "devnet", error: "faucet closed" },
        }),
      ]);
      const note = String(fresh.println.mock.calls.at(-1)?.[0]);
      expect(note).toContain("automatic airdrop request");
      expect(note).not.toContain("faucet.solana.com");
    });
  });
});
