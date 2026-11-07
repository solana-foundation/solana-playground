/* eslint-disable layers/curry-order, max-params -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { isFaucetLimit } from "@/shared/lib/faucet-limit";
import { createLogger, toError } from "@/shared/lib/logger";

import { airdropTopUp } from "../../../../commands/deploy/airdrop-top-up";

const LAMPORTS_PER_SOL = 1_000_000_000;

const log = createLogger("tutorial-conversation:fund");

/**
 * What funding needs from devnet, by address. The real one is
 * `devnetFunding`; a test answers from a script.
 */
export interface FundingChain {
  /** Lamports the address holds */
  balance(address: string): Promise<number>;
  /** Requests an airdrop; throws when the faucet refuses or rate limits */
  airdrop(address: string, lamports: number): Promise<string>;
  /** Whether the transaction confirmed without an error */
  confirm(signature: string): Promise<boolean>;
}

export type FundingResult =
  | { ok: true; balance: number; airdropped: number }
  | { ok: false; balance: number; message: string };

export interface FundingInput {
  chain: FundingChain;
  address: string;
  /** Lamports the wallet must hold for the deploy, fee headroom included */
  need: number;
  /** The cluster's faucet amount in whole SOL */
  capSol: number;
  /** Called once, before the airdrop, only when the wallet is short */
  onShort: (airdropSol: number) => void;
  /** Waits between balance reads; the real one sleeps a slot */
  wait?: (ms: number) => Promise<void>;
}

/** Reads after a confirmed airdrop before calling the balance unchanged */
const BALANCE_READS = 3;
const SLOT_MS = 400;

/**
 * Tops the wallet up for a deploy, without the editor's sign-in gate
 * (`checkSignedIn` on the `airdrop` command): a tutorial promises a wallet
 * with free test SOL, signed in or not (Slava, 3 Nov). One airdrop of the
 * shortfall plus headroom (`airdropTopUp`); a refusal, a rate limit or a
 * balance that never moves is a result, never a throw, so the act card can
 * post "Not enough devnet SOL" with the balance it read. Each is logged: the
 * faucet's limit as a warning, anything else reported.
 */
export const fundForDeploy = async ({
  chain,
  address,
  need,
  capSol,
  onShort,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
}: FundingInput): Promise<FundingResult> => {
  const before = await chain.balance(address);
  if (before >= need) return { ok: true, balance: before, airdropped: 0 };

  const sol = airdropTopUp((need - before) / LAMPORTS_PER_SOL, capSol);
  onShort(sol);
  let signature: string;
  try {
    signature = await chain.airdrop(address, sol * LAMPORTS_PER_SOL);
  } catch (e) {
    const error = toError(e);
    // The faucet's limit is expected: a warning, never a report. Neither
    // line carries the wallet's address
    if (isFaucetLimit(error.message)) {
      log.warn("The devnet faucet refused an airdrop", {
        context: { message: error.message },
      });
    } else {
      log.error(error, {
        report: true,
        context: { stage: "Requesting an airdrop" },
      });
    }
    return { ok: false, balance: before, message: error.message };
  }
  // An unconfirmed airdrop (a timeout) may still have landed, so the
  // balance decides either way; a confirmed one can read as the old balance
  // for a slot or two
  const confirmed = await chain.confirm(signature);
  for (let i = 0; i < BALANCE_READS; i++) {
    const after = await chain.balance(address);
    if (after >= need) {
      return { ok: true, balance: after, airdropped: after - before };
    }
    if (i < BALANCE_READS - 1) await wait(SLOT_MS);
  }
  const message = confirmed
    ? "The airdrop did not reach the wallet"
    : "The airdrop failed";
  log.warn(message, { report: true });
  return { ok: false, balance: await chain.balance(address), message };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/fund", () => {
    const SOL = 1_000_000_000;
    const ADDRESS = "Wa11et1111111111111111111111111111111111111";
    let logger: typeof import("@/shared/lib/logger");
    let logged: ReturnType<typeof import("@/shared/lib/logger").memoryProvider>;

    beforeAll(async () => {
      logger = await import("@/shared/lib/logger");
    });
    beforeEach(() => {
      logged = logger.memoryProvider();
      logger.initLogger({ providers: [logged] });
    });
    afterEach(() => logger.resetLogger());

    /** A chain whose balances come from a list, the last one repeating */
    const chainOf = (
      balances: number[],
      airdrop: FundingChain["airdrop"] = async () => "sig",
      confirmed = true
    ) => {
      const reads = balances.slice();
      return {
        balance: vi.fn(
          async () => (reads.length > 1 ? reads.shift() : undefined) ?? reads[0]
        ),
        airdrop: vi.fn(airdrop),
        confirm: vi.fn(async () => confirmed),
      };
    };
    const noWait = async () => {};

    it("asks for nothing when the balance covers the deploy", async () => {
      const chain = chainOf([2 * SOL]);
      const onShort = vi.fn();
      await expect(
        fundForDeploy({
          chain,
          address: ADDRESS,
          need: SOL,
          capSol: 5,
          onShort,
          wait: noWait,
        })
      ).resolves.toEqual({ ok: true, balance: 2 * SOL, airdropped: 0 });
      expect(onShort).not.toHaveBeenCalled();
      expect(chain.airdrop).not.toHaveBeenCalled();
    });

    it("airdrops the shortfall plus headroom and reports what arrived", async () => {
      const chain = chainOf([0, 0, 2 * SOL]);
      const onShort = vi.fn();
      await expect(
        fundForDeploy({
          chain,
          address: ADDRESS,
          need: 1.5 * SOL,
          capSol: 5,
          onShort,
          wait: noWait,
        })
      ).resolves.toEqual({ ok: true, balance: 2 * SOL, airdropped: 2 * SOL });
      expect(onShort).toHaveBeenCalledWith(2);
      expect(chain.airdrop).toHaveBeenCalledWith(ADDRESS, 2 * SOL);
    });

    it("answers a refused or rate-limited airdrop with the balance it read", async () => {
      const chain = chainOf([0.2 * SOL], async () => {
        throw new Error("429 Too Many Requests");
      });
      await expect(
        fundForDeploy({
          chain,
          address: ADDRESS,
          need: 1.5 * SOL,
          capSol: 5,
          onShort: () => {},
          wait: noWait,
        })
      ).resolves.toEqual({
        ok: false,
        balance: 0.2 * SOL,
        message: "429 Too Many Requests",
      });
    });

    it("waits a slot between reads for a confirmed airdrop to show", async () => {
      const chain = chainOf([0, 0, 0, 2 * SOL]);
      const wait = vi.fn(async () => {});
      await expect(
        fundForDeploy({
          chain,
          address: ADDRESS,
          need: SOL,
          capSol: 5,
          onShort: () => {},
          wait,
        })
      ).resolves.toEqual({ ok: true, balance: 2 * SOL, airdropped: 2 * SOL });
      expect(wait).toHaveBeenCalledTimes(2);
    });

    it("counts an unconfirmed airdrop that still reached the wallet", async () => {
      const chain = chainOf([0, 2 * SOL], async () => "sig", false);
      await expect(
        fundForDeploy({
          chain,
          address: ADDRESS,
          need: SOL,
          capSol: 5,
          onShort: () => {},
          wait: noWait,
        })
      ).resolves.toMatchObject({ ok: true, balance: 2 * SOL });
    });

    it("answers an airdrop that failed on chain", async () => {
      const chain = chainOf([0], async () => "sig", false);
      await expect(
        fundForDeploy({
          chain,
          address: ADDRESS,
          need: SOL,
          capSol: 5,
          onShort: () => {},
          wait: noWait,
        })
      ).resolves.toEqual({
        ok: false,
        balance: 0,
        message: "The airdrop failed",
      });
    });

    it("answers a confirmed airdrop whose balance never moved", async () => {
      const chain = chainOf([0]);
      await expect(
        fundForDeploy({
          chain,
          address: ADDRESS,
          need: SOL,
          capSol: 5,
          onShort: () => {},
          wait: noWait,
        })
      ).resolves.toEqual({
        ok: false,
        balance: 0,
        message: "The airdrop did not reach the wallet",
      });
    });

    /** Funds a 1.5 SOL deploy from 0.2 SOL over `chain` */
    const fundShort = (chain: FundingChain) =>
      fundForDeploy({
        chain,
        address: ADDRESS,
        need: 1.5 * SOL,
        capSol: 5,
        onShort: () => {},
        wait: noWait,
      });

    it("warns of a faucet limit without reporting it, and never logs the wallet", async () => {
      await fundShort(
        chainOf([0.2 * SOL], async () => {
          throw new Error("429 Too Many Requests");
        })
      );
      expect(logged.entries).toEqual([
        expect.objectContaining({
          ns: "tutorial-conversation:fund",
          level: "warn",
          report: false,
          context: { message: "429 Too Many Requests" },
        }),
      ]);
      expect(JSON.stringify(logged.entries)).not.toContain(ADDRESS);
    });

    it("reports an airdrop that threw for any other reason", async () => {
      const failure = new Error("fetch failed");
      await expect(
        fundShort(
          chainOf([0.2 * SOL], async () => {
            throw failure;
          })
        )
      ).resolves.toMatchObject({ ok: false, message: "fetch failed" });
      expect(logged.entries).toEqual([
        expect.objectContaining({
          ns: "tutorial-conversation:fund",
          level: "error",
          error: failure,
          report: true,
        }),
      ]);
      expect(JSON.stringify(logged.entries)).not.toContain(ADDRESS);
    });

    it.each([
      ["failed on chain", false, "The airdrop failed"],
      [
        "confirmed but never arrived",
        true,
        "The airdrop did not reach the wallet",
      ],
    ])("reports an airdrop that %s", async (_case, confirmed, message) => {
      await fundShort(chainOf([0], async () => "sig", confirmed));
      expect(logged.entries).toEqual([
        expect.objectContaining({
          ns: "tutorial-conversation:fund",
          level: "warn",
          message,
          report: true,
        }),
      ]);
    });

    it("logs nothing when the airdrop lands", async () => {
      await fundShort(chainOf([0, 2 * SOL]));
      expect(logged.entries).toEqual([]);
    });
  });
}
