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

/**
 * Makes `confirmTransaction` poll `getSignatureStatuses` over RPC.
 *
 * The sandbox carries no websocket to the page, and Playnet has none, so
 * confirmation reads the status over the RPC bridge until it reaches the
 * commitment, the transaction fails, its blockhash expires or, without one,
 * the time runs out.
 *
 * @param web3 the sandbox's web3.js module
 */
export const patchConfirmTransaction = (web3: Web3) => {
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  // eslint-disable-next-line max-params -- web3.js defines the signature
  web3.Connection.prototype.confirmTransaction = async function (
    this: InstanceType<Web3["Connection"]>,
    strategy: string | TransactionConfirmationStrategy,
    // eslint-disable-next-line layers/curry-order -- web3.js defines the signature
    commitment?: Commitment
  ) {
    const signature =
      typeof strategy === "string" ? strategy : strategy.signature;
    const lastValidBlockHeight =
      typeof strategy === "object" && "lastValidBlockHeight" in strategy
        ? strategy.lastValidBlockHeight
        : undefined;
    const target = commitment ?? this.commitment ?? "finalized";
    const deadline = Date.now() + TIMEOUT_SECONDS * 1000;

    for (;;) {
      const { context, value } = await this.getSignatureStatuses([signature]);
      const status = value[0];
      const reached = RANK[status?.confirmationStatus ?? "processed"] ?? 0;
      // Success and failure alike count only at the commitment asked for, as
      // in web3.js: a failure seen at `processed` may sit on a fork that is
      // dropped, and the transaction can still land elsewhere
      if (status && reached >= (RANK[target] ?? 2)) {
        // eslint-disable-next-line unicorn/no-null -- web3.js's result shape
        return { context, value: { err: status.err ?? null } };
      }

      if (lastValidBlockHeight !== undefined) {
        const height = await this.getBlockHeight(target);
        if (height > lastValidBlockHeight) {
          throw new web3.TransactionExpiredBlockheightExceededError(signature);
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
