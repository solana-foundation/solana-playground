import { airdropTopUp } from "../../../../commands/deploy/airdrop-top-up";

const LAMPORTS_PER_SOL = 1_000_000_000;

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
 * post "Not enough devnet SOL" with the balance it read.
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
    return {
      ok: false,
      balance: before,
      message: e instanceof Error ? e.message : String(e),
    };
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
  return {
    ok: false,
    balance: await chain.balance(address),
    message: confirmed
      ? "The airdrop did not reach the wallet"
      : "The airdrop failed",
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/fund", () => {
    const SOL = 1_000_000_000;
    const ADDRESS = "Wa11et1111111111111111111111111111111111111";

    /** A chain whose balances come from a list, the last one repeating */
    const chainOf = (
      balances: number[],
      airdrop: FundingChain["airdrop"] = async () => "sig",
      confirmed = true
    ) => {
      const reads = balances.slice();
      return {
        balance: vi.fn(async () =>
          reads.length > 1 ? reads.shift()! : reads[0]
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
  });
}
