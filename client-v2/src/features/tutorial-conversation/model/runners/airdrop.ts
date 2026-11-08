import { createLogger } from "@/shared/lib/logger";

import type { RunStage } from "../ports";
import type { RunResult } from "../progress";
import type { DeployPort } from "./deploy";
import { deployCost } from "./deploy";
import { fundForDeploy } from "./fund";

const log = createLogger("tutorial-conversation:airdrop");

/** The airdrop card's one stage, while the faucet answers */
export const AIRDROP_STAGE = "Requesting airdrop";

/**
 * Whether the Playground wallet already covers the next deploy, so the
 * airdrop card passes with no press. False with no wallet: the press makes it
 */
export const isFundedForDeploy = async (port: DeployPort): Promise<boolean> => {
  const address = port.wallet();
  if (!address) return false;
  return (await coveringBalance(port, address)) !== undefined;
};

/** The wallet's balance when it covers the next deploy; `undefined` when short */
const coveringBalance = async (port: DeployPort, address: string) => {
  const [balance, cost] = await Promise.all([
    port.funding.balance(address),
    deployCost(port),
  ]);
  return balance >= cost ? balance : undefined;
};

/**
 * Off devnet, the balance of a wallet that already covers the deploy, so the
 * card passes with nothing airdropped; `undefined` when there is no wallet,
 * it is short, or the cluster cannot be read, and the refusal stands
 */
const fundedOffDevnet = async (port: DeployPort, address: string | null) => {
  if (!address) return undefined;
  try {
    return await coveringBalance(port, address);
  } catch (e) {
    // The refusal says what to do; an unreadable cluster adds nothing to it
    log.debug("Could not read the wallet's balance off devnet", {
      context: { error: e },
    });
    return undefined;
  }
};

/**
 * The airdrop act (HOO-2677): funds the Playground wallet for the deploy after
 * it, with one airdrop of the shortfall plus headroom (`fundForDeploy`). No
 * wallet yet: the press makes one first. A funded wallet lands at once with
 * nothing airdropped, on any cluster: only the airdrop is devnet's, and the
 * deploy after it still refuses elsewhere. A refusal is `no_funds` with the
 * facts the "Not enough devnet SOL" card shows, never a throw.
 */
export const runAirdropWith =
  (onStage: (stage: RunStage) => void) =>
  async (port: DeployPort): Promise<RunResult> => {
    const started = port.now();
    const seconds = () => (port.now() - started) / 1000;
    const refusal = port.refusal();
    if (refusal) {
      const balance = await fundedOffDevnet(port, port.wallet());
      if (balance !== undefined) {
        return {
          act: "airdrop",
          ok: true,
          seconds: seconds(),
          balance,
          airdropped: 0,
        };
      }
      return {
        act: "airdrop",
        ok: false,
        seconds: seconds(),
        reason: "failed",
        message: refusal,
      };
    }
    const existing = port.wallet();
    const address = existing ?? (await port.createWallet());
    const cost = await deployCost(port);
    const funded = await fundForDeploy({
      chain: port.funding,
      address,
      need: cost,
      capSol: port.capSol,
      onShort: (amount) => {
        onStage({ label: AIRDROP_STAGE, index: 1, count: 1 });
        port.print(`Airdropping ${amount} SOL...`);
      },
    });
    if (!funded.ok) {
      return {
        act: "airdrop",
        ok: false,
        seconds: seconds(),
        reason: "no_funds",
        message: funded.message,
        balance: funded.balance,
        cost,
        address,
      };
    }
    return {
      act: "airdrop",
      ok: true,
      seconds: seconds(),
      balance: funded.balance,
      airdropped: funded.airdropped,
      ...(existing === null && { madeWallet: true as const }),
    };
  };

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/airdrop", () => {
    const SOL = 1_000_000_000;
    const WALLET = "Wa11et1111111111111111111111111111111111111";
    const PROGRAM = "Prog111111111111111111111111111111111111111";
    /** 100 000 bytes at 10 000 lamports a byte, plus the fee headroom */
    const COST = 100_000 * 10_000;
    /** The port's "none" answers: its contract spells them null */
    // eslint-disable-next-line unicorn/no-null -- DeployPort answers null for no refusal and no wallet
    const [noRefusal, noWallet] = [() => null, () => null];

    /** What the scripted port answers besides its balances */
    interface Chain {
      wallet: () => string | null;
      airdrop: () => Promise<string>;
    }

    /** A port over a scripted chain: balances are read in order, the last repeating */
    const portWith = (chain: Chain) => (balances: number[]) => {
      const reads = balances.slice();
      const lines: string[] = [];
      const port = {
        refusal: noRefusal,
        wallet: chain.wallet,
        createWallet: vi.fn(async () => WALLET),
        program: () => ({
          id: PROGRAM,
          keypair: true,
          stale: false,
          length: 100_000,
        }),
        onChain: async () => ({ deployed: false as const }),
        rent: async (length: number) => length * 10_000,
        funding: {
          balance: vi.fn(
            async () =>
              (reads.length > 1 ? reads.shift() : undefined) ?? reads[0]
          ),
          airdrop: vi.fn(chain.airdrop),
          confirm: async () => true,
        },
        capSol: 5,
        print: (line: string) => lines.push(line),
        now: () => 1_000,
      } as unknown as DeployPort;
      return { port, lines };
    };
    const faucet = async () => "airdropSig";
    const portOf = portWith({ wallet: () => WALLET, airdrop: faucet });
    const walletlessPortOf = portWith({ wallet: noWallet, airdrop: faucet });
    const refusingPortOf = portWith({
      wallet: () => WALLET,
      airdrop: async () => {
        throw new Error("429 Too Many Requests");
      },
    });
    const run = runAirdropWith(() => {});

    it("lands a funded wallet with nothing airdropped", async () => {
      const { port, lines } = portOf([3.2 * SOL]);
      const stages: RunStage[] = [];
      await expect(
        runAirdropWith((s) => stages.push(s))(port)
      ).resolves.toEqual({
        act: "airdrop",
        ok: true,
        seconds: 0,
        balance: 3.2 * SOL,
        airdropped: 0,
      });
      expect(port.funding.airdrop).not.toHaveBeenCalled();
      expect(stages).toEqual([]);
      expect(lines).toEqual([]);
    });

    it("airdrops the shortfall against the deploy's cost", async () => {
      const { port, lines } = portOf([0, 2 * SOL]);
      const stages: RunStage[] = [];
      await expect(
        runAirdropWith((s) => stages.push(s))(port)
      ).resolves.toMatchObject({
        act: "airdrop",
        ok: true,
        balance: 2 * SOL,
        airdropped: 2 * SOL,
      });
      expect(port.funding.airdrop).toHaveBeenCalledWith(WALLET, 2 * SOL);
      expect(lines).toEqual(["Airdropping 2 SOL..."]);
      expect(stages).toEqual([
        { label: "Requesting airdrop", index: 1, count: 1 },
      ]);
    });

    it("makes the wallet first when there is none, in the same press", async () => {
      const { port } = walletlessPortOf([0, 2 * SOL]);
      await expect(run(port)).resolves.toMatchObject({
        ok: true,
        airdropped: 2 * SOL,
        madeWallet: true,
      });
      expect(port.createWallet).toHaveBeenCalledTimes(1);
      expect(port.funding.airdrop).toHaveBeenCalledWith(WALLET, 2 * SOL);
    });

    it("answers a refused airdrop with no_funds and the card's facts", async () => {
      const { port } = refusingPortOf([0.1 * SOL]);
      const result = await run(port);
      expect(result).toMatchObject({
        act: "airdrop",
        ok: false,
        reason: "no_funds",
        message: "429 Too Many Requests",
        balance: 0.1 * SOL,
        address: WALLET,
      });
      expect(result).toHaveProperty("cost", await deployCost(port));
      expect((result as { cost: number }).cost).toBeGreaterThan(COST);
    });

    it("refuses off devnet before it touches the wallet", async () => {
      const { port } = walletlessPortOf([0]);
      port.refusal = () => "Tutorials deploy to devnet.";
      await expect(run(port)).resolves.toMatchObject({
        act: "airdrop",
        ok: false,
        reason: "failed",
        message: "Tutorials deploy to devnet.",
      });
      expect(port.createWallet).not.toHaveBeenCalled();
    });

    it("passes a funded wallet off devnet with nothing airdropped", async () => {
      const { port } = portOf([3.2 * SOL]);
      port.refusal = () => "Tutorials deploy to devnet.";
      await expect(run(port)).resolves.toMatchObject({
        act: "airdrop",
        ok: true,
        balance: 3.2 * SOL,
        airdropped: 0,
      });
      expect(port.funding.airdrop).not.toHaveBeenCalled();
    });

    it("refuses a short wallet off devnet and airdrops nothing", async () => {
      const { port } = portOf([0.1 * SOL]);
      port.refusal = () => "Tutorials deploy to devnet.";
      await expect(run(port)).resolves.toMatchObject({
        ok: false,
        reason: "failed",
        message: "Tutorials deploy to devnet.",
      });
      expect(port.funding.airdrop).not.toHaveBeenCalled();
    });

    it("refuses off devnet when the balance cannot be read", async () => {
      const { port } = portOf([0]);
      port.refusal = () => "Tutorials deploy to devnet.";
      port.funding.balance = vi.fn(async () => {
        throw new Error("fetch failed");
      });
      await expect(run(port)).resolves.toMatchObject({
        ok: false,
        message: "Tutorials deploy to devnet.",
      });
    });

    describe("isFundedForDeploy", () => {
      it("is true only for a wallet that covers the deploy", async () => {
        await expect(isFundedForDeploy(portOf([3.2 * SOL]).port)).resolves.toBe(
          true
        );
        await expect(isFundedForDeploy(portOf([0.1 * SOL]).port)).resolves.toBe(
          false
        );
      });

      it("is false with no wallet, and reads nothing", async () => {
        const { port } = walletlessPortOf([5 * SOL]);
        await expect(isFundedForDeploy(port)).resolves.toBe(false);
        expect(port.funding.balance).not.toHaveBeenCalled();
      });
    });
  });
}
