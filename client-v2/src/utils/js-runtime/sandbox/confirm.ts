import type {
  Commitment,
  TransactionConfirmationStrategy,
} from "@solana/web3.js";

type Web3 = typeof import("@solana/web3.js");

/** Commitment levels in the order a transaction reaches them */
const RANK: Record<string, number> = {
  processed: 0,
  recent: 0,
  confirmed: 1,
  single: 1,
  singleGossip: 1,
  finalized: 2,
  max: 2,
  root: 2,
};

/** How long a confirmation by signature alone waits */
const TIMEOUT_SECONDS = 60;

/** Pause between two status reads */
const POLL_MS = 500;

/** Pause between two reads of a durable nonce, as web3.js's own confirm */
const NONCE_POLL_MS = 2000;

type Connection = InstanceType<Web3["Connection"]>;

/**
 * When a transaction confirmed by one of the strategies can no longer land:
 * its blockhash's last block height, its durable nonce advancing, or, with a
 * signature alone, the time running out
 */
type Expiry =
  | { kind: "blockheight"; lastValidBlockHeight: number }
  | {
      kind: "nonce";
      nonceAccountPubkey: import("@solana/web3.js").PublicKey;
      nonceValue: string;
      minContextSlot: number;
    }
  | { kind: "timeout" };

/** The expiry of a `confirmTransaction` strategy */
const expiryOf = (
  strategy: string | TransactionConfirmationStrategy
): Expiry => {
  if (typeof strategy === "string") return { kind: "timeout" };
  if ("lastValidBlockHeight" in strategy) {
    return {
      kind: "blockheight",
      lastValidBlockHeight: strategy.lastValidBlockHeight,
    };
  }
  if ("nonceValue" in strategy) {
    return {
      kind: "nonce",
      nonceAccountPubkey: strategy.nonceAccountPubkey,
      nonceValue: strategy.nonceValue,
      minContextSlot: strategy.minContextSlot,
    };
  }
  return { kind: "timeout" };
};

/**
 * Makes `confirmTransaction` poll `getSignatureStatuses` over RPC.
 *
 * The sandbox carries no websocket to the page, and Playnet has none, so
 * confirmation reads the status over the RPC bridge until it reaches the
 * commitment, the transaction fails, or it expires as its strategy says
 * (`Expiry`): a durable-nonce transaction stays live, however long, until its
 * nonce advances without it.
 *
 * @param web3 the sandbox's web3.js module
 */
export const patchConfirmTransaction = (web3: Web3) => {
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  // eslint-disable-next-line max-params -- web3.js defines the signature
  web3.Connection.prototype.confirmTransaction = async function (
    this: Connection,
    strategy: string | TransactionConfirmationStrategy,
    // eslint-disable-next-line layers/curry-order -- web3.js defines the signature
    commitment?: Commitment
  ) {
    const signature =
      typeof strategy === "string" ? strategy : strategy.signature;
    const expiry = expiryOf(strategy);
    const target = commitment ?? this.commitment ?? "finalized";
    const deadline = Date.now() + TIMEOUT_SECONDS * 1000;
    let nonceReadAt = Number.NEGATIVE_INFINITY;

    for (;;) {
      const { context, value } = await this.getSignatureStatuses([signature]);
      const status = value[0];
      const reached = RANK[status?.confirmationStatus ?? "processed"] ?? 0;
      // Success and failure alike count only at the commitment asked for, as
      // web3.js's subscription path notifies, and unlike its one-shot status
      // check, which rejects on any `err`: a failure seen at `processed` may
      // sit on a fork that is dropped, and the transaction can still land
      // elsewhere
      if (status && reached >= (RANK[target] ?? 2)) {
        // eslint-disable-next-line unicorn/no-null -- web3.js's result shape
        return { context, value: { err: status.err ?? null } };
      }

      if (expiry.kind === "blockheight") {
        const height = await this.getBlockHeight(target);
        if (height > expiry.lastValidBlockHeight) {
          throw new web3.TransactionExpiredBlockheightExceededError(signature);
        }
      } else if (expiry.kind === "nonce") {
        if (Date.now() - nonceReadAt >= NONCE_POLL_MS) {
          nonceReadAt = Date.now();
          // A nonce that moved on while the transaction has no status was
          // advanced by another transaction, so this one can never land. One
          // that moved on with a status was advanced by this transaction,
          // which goes on to the commitment.
          if ((await nonceOf(this)(target)(expiry)) !== expiry.nonceValue) {
            const recheck = await this.getSignatureStatuses([signature]);
            if (!recheck.value[0]) {
              throw new web3.TransactionExpiredNonceInvalidError(signature);
            }
          }
        }
      } else if (Date.now() > deadline) {
        throw new web3.TransactionExpiredTimeoutError(
          signature,
          TIMEOUT_SECONDS
        );
      }

      await sleep(POLL_MS);
    }
  } as never;
};

/**
 * The nonce a durable-nonce account holds now, or the one the transaction was
 * built with when the account cannot be read: as web3.js's own confirm, a
 * failed read is no reason to call a live transaction expired
 */
const nonceOf =
  (connection: Connection) =>
  (commitment: Commitment) =>
  async (expiry: Extract<Expiry, { kind: "nonce" }>) => {
    try {
      const { value } = await connection.getNonceAndContext(
        expiry.nonceAccountPubkey,
        { commitment, minContextSlot: expiry.minContextSlot }
      );
      return value?.nonce;
    } catch {
      // Unread, not advanced: the next read decides
      return expiry.nonceValue;
    }
  };

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, it, vi } = import.meta
    .vitest;

  describe("utils/js-runtime/sandbox/confirm", () => {
    class Expired extends Error {
      constructor(readonly kind: string) {
        super(kind);
      }
    }
    /** What the fake cluster answers, changed by each test */
    const cluster = {
      status: undefined as
        | { confirmationStatus: string; err: unknown }
        | undefined,
      height: 0,
      nonce: "nonce-1" as string | undefined,
    };
    class FakeConnection {
      commitment = "confirmed";
      getSignatureStatuses = vi.fn(async () => ({
        context: { slot: 1 },
        value: [cluster.status],
      }));
      getBlockHeight = vi.fn(async () => cluster.height);
      getNonceAndContext = vi.fn(async () => ({
        context: { slot: 1 },
        // eslint-disable-next-line unicorn/no-null -- web3.js's result shape
        value: cluster.nonce === undefined ? null : { nonce: cluster.nonce },
      }));
    }
    const fakeWeb3 = {
      Connection: FakeConnection,
      TransactionExpiredBlockheightExceededError: class extends Expired {
        constructor() {
          super("blockheight");
        }
      },
      TransactionExpiredNonceInvalidError: class extends Expired {
        constructor() {
          super("nonce");
        }
      },
      TransactionExpiredTimeoutError: class extends Expired {
        constructor() {
          super("timeout");
        }
      },
    };
    patchConfirmTransaction(fakeWeb3 as unknown as Web3);

    const confirm = (strategy: unknown) =>
      (
        new FakeConnection() as unknown as {
          confirmTransaction: (s: unknown) => Promise<unknown>;
        }
      ).confirmTransaction(strategy);
    const nonceStrategy = {
      signature: "sig",
      minContextSlot: 0,
      nonceAccountPubkey: "nonce-account",
      nonceValue: "nonce-1",
    };
    /** How a confirmation settled, once the clock has run `ms` */
    const settledAfter = (ms: number) => async (promise: Promise<unknown>) => {
      let outcome: unknown = "pending";
      promise.then(
        (value) => (outcome = value),
        (error: unknown) =>
          (outcome = error instanceof Expired ? error.kind : error)
      );
      await vi.advanceTimersByTimeAsync(ms);
      return outcome;
    };

    beforeEach(() => {
      vi.useFakeTimers();
      cluster.status = undefined;
      cluster.height = 0;
      cluster.nonce = "nonce-1";
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("gives up on a bare signature after 60 s", async () => {
      expect(await settledAfter(61_000)(confirm("sig"))).toBe("timeout");
    });

    it("expires a blockhash strategy once the block height passes", async () => {
      const confirming = confirm({
        signature: "sig",
        blockhash: "hash",
        lastValidBlockHeight: 10,
      });
      expect(await settledAfter(61_000)(confirming)).toBe("pending");
      cluster.height = 11;
      expect(await settledAfter(1_000)(confirming)).toBe("blockheight");
    });

    it("keeps waiting on a durable nonce past 60 s while the nonce holds", async () => {
      const confirming = confirm(nonceStrategy);
      expect(await settledAfter(120_000)(confirming)).toBe("pending");
      cluster.status = { confirmationStatus: "confirmed", err: undefined };
      expect(await settledAfter(1_000)(confirming)).toEqual({
        context: { slot: 1 },
        // eslint-disable-next-line unicorn/no-null -- web3.js's result shape
        value: { err: null },
      });
    });

    it("expires a durable nonce that another transaction advanced", async () => {
      const confirming = confirm(nonceStrategy);
      cluster.nonce = "nonce-2";
      expect(await settledAfter(3_000)(confirming)).toBe("nonce");
    });

    it("waits on a durable nonce its own transaction advanced", async () => {
      const confirming = confirm(nonceStrategy);
      cluster.nonce = "nonce-2";
      cluster.status = { confirmationStatus: "processed", err: undefined };
      expect(await settledAfter(3_000)(confirming)).toBe("pending");
      cluster.status = { confirmationStatus: "confirmed", err: undefined };
      expect(await settledAfter(1_000)(confirming)).toEqual({
        context: { slot: 1 },
        // eslint-disable-next-line unicorn/no-null -- web3.js's result shape
        value: { err: null },
      });
    });
  });
}
