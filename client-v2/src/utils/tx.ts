import { createLogger } from "@/shared/lib/logger";

import { PgCommon } from "./common";
import { PgConnection } from "./connection";
import { PgSettings } from "./settings";
import type { Arrayable } from "./types";
import { PgWallet, Wallet, WalletOption } from "./wallet";
import { PgWeb3 } from "./web3";

type TransactionSimulateOptions = TransactionSendOptions;

type TransactionSendOptions = {
  /** Keypairs to sign the transaction */
  keypairSigners?: PgWeb3.Signer[];
  /** Wallets to sign the transaction */
  walletSigners?: Wallet[];
  /**
   * Add a compute unit limit instruction with this value.
   *
   * **Note:** This value does not override if the transaction already has a
   * `setComputeUnitLimit` instruction.
   */
  computeUnitLimit?: number;
  /** Do not use the cached blockhash */
  forceFetchLatestBlockhash?: boolean;
  /**
   * Connection to send on, instead of the current one. A caller that confirms
   * afterwards passes the same one to `confirm`, so a cluster change while
   * the wallet asks for approval cannot split the two.
   */
  connection?: PgWeb3.Connection;
} & WalletOption;

type Transactionable =
  | PgWeb3.Transaction
  | Arrayable<PgWeb3.TransactionInstruction>;

const log = createLogger("utils:tx");

/**
 * Answers to a send that `PgTx.send` meets by signing again with a fresh blockhash: "already processed" names an
 * earlier transaction with the same data and the cached blockhash
 */
const RESENT_ON = [
  "This transaction has already been processed",
  "Blockhash not found",
];

/**
 * Sends with a fresh blockhash after one of {@link RESENT_ON}, at most: a cluster that still answers so is stalled
 * or behind, and the error then reaches the caller, whose own retries (a deploy's rounds and its stall limit) see it
 */
const MAX_FRESH_BLOCKHASH_SENDS = 3;

/** The host of a connection's RPC, for logs: its user info, path or query may carry an API key */
const hostOf = (connection: PgWeb3.Connection) => {
  try {
    return new URL(connection.rpcEndpoint).host;
  } catch {
    // Silent on purpose: this only names the RPC in a log line, and the send itself reports a URL it cannot use
    return "an RPC with an unreadable URL";
  }
};

export class PgTx {
  /** All transaction event names */
  static readonly events = {
    ON_DID_SEND: "txondidsend",
  };

  /**
   * Simulate a transaction with opinionated (good) defaults.
   *
   * @param txable transaction to simulate
   * @param opts simulation options
   * @returns the transaction simulation response
   */
  static async simulate(
    txable: Transactionable,
    opts?: TransactionSimulateOptions
  ) {
    const { connection, tx } = await this._prepareTx(txable, opts);
    const result = await connection.simulateTransaction(tx);
    return result.value;
  }

  /**
   * Send a transaction with opinionated (good) defaults.
   *
   * @param txable transaction to send
   * @param opts send options
   * @returns the transaction signature
   * @throws the RPC's error, also a "Blockhash not found" or "already processed" one still answered after
   * {@link MAX_FRESH_BLOCKHASH_SENDS} sends with a fresh blockhash
   */
  static async send(
    txable: Transactionable,
    opts?: TransactionSendOptions
  ): Promise<string> {
    return await this._send({ txable, opts, resent: 0 });
  }

  /** {@link PgTx.send}, after `resent` sends with a fresh blockhash */
  private static async _send({
    txable,
    opts,
    resent,
  }: {
    txable: Transactionable;
    opts: TransactionSendOptions | undefined;
    resent: number;
  }): Promise<string> {
    const { connection, tx } = await this._prepareTx(txable, opts);

    // Caching the blockhash will result in getting the same tx signature when
    // using the same tx data.
    // https://github.com/solana-playground/solana-playground/issues/116
    let txHash;
    try {
      txHash = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: !PgSettings.connection.preflightChecks,
      });
    } catch (e: any) {
      const answer = RESENT_ON.find((a) => e.message.includes(a));
      if (answer && resent < MAX_FRESH_BLOCKHASH_SENDS) {
        log.debug("Sending again with a fresh blockhash", {
          context: { answer, resent: resent + 1, endpoint: hostOf(connection) },
        });
        // A cluster whose blockhash has not moved gives the same one back, so the later sends wait a slot first
        if (resent > 0) await PgCommon.sleep(PgWeb3.DEFAULT_MS_PER_SLOT);
        // Reset signatures
        tx.signatures = [];
        return await this._send({
          txable: tx,
          opts: { ...opts, forceFetchLatestBlockhash: true },
          resent: resent + 1,
        });
      }
      // With preflight on, a refused send was not forwarded: the caller gets the error, never another send's signature
      if (answer) {
        log.warn("The cluster still refused the send after fresh blockhashes", {
          context: { answer, resent, endpoint: hostOf(connection) },
        });
      }

      throw e;
    }

    // Dispatch transaction send event
    PgCommon.createAndDispatchCustomEvent(PgTx.events.ON_DID_SEND, tx);

    return txHash;
  }

  /**
   * Confirm a transaction.
   *
   * @throws if rpc request fails
   * @returns an object with `err` property if the rpc request succeeded but tx failed
   */
  static async confirm(
    txHash: string,
    opts?: { commitment?: PgWeb3.Commitment; connection?: PgWeb3.Connection }
  ) {
    const connection = opts?.connection ?? PgConnection.current;
    const result = await connection.confirmTransaction(
      txHash,
      opts?.commitment
    );
    if (result?.value.err) return { err: result.value.err };
  }

  /**
   * Runs after sending a transaction.
   *
   * @param cb callback function to run after a transaction gets sent
   * @returns a dispose function to clear the event
   */
  static onDidSend(cb: (tx: PgWeb3.Transaction) => unknown) {
    return PgCommon.onDidChange(PgTx.events.ON_DID_SEND, cb);
  }

  /** Prepare the transaction for simulation and send. */
  private static async _prepareTx(
    txable: Transactionable,
    opts?: TransactionSendOptions
  ) {
    let tx =
      txable instanceof PgWeb3.Transaction
        ? txable
        : new PgWeb3.Transaction().add(...PgCommon.toArray(txable));

    const wallet = opts?.wallet ?? PgWallet.current;
    if (!wallet) throw new Error("Wallet not connected");

    const connection = opts?.connection ?? PgConnection.current;

    // Set priority fees if the transaction doesn't already have it
    const existingSetComputeUnitPriceIx = tx.instructions.find(
      (ix) =>
        ix.programId.equals(PgWeb3.ComputeBudgetProgram.programId) &&
        ix.data.at(0) === 3 // `setComputeUnitPrice`
    );
    if (!existingSetComputeUnitPriceIx) {
      const priorityFeeSetting = PgSettings.connection.priorityFee;
      const priorityFee =
        typeof priorityFeeSetting === "number"
          ? priorityFeeSetting
          : (await this._getPriorityFee(connection))[priorityFeeSetting];
      if (priorityFee) {
        tx.instructions.unshift(
          PgWeb3.ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFee,
          })
        );
      }
    }

    // Set compute unit limit if specified
    if (opts?.computeUnitLimit) {
      // Check for existing `setComputeUnitLimit` ix
      const existingSetComputeUnitLimitIx = tx.instructions.find(
        (ix) =>
          ix.programId.equals(PgWeb3.ComputeBudgetProgram.programId) &&
          ix.data.at(0) === 2 // `setComputeUnitLimit`
      );
      if (!existingSetComputeUnitLimitIx) {
        tx.instructions.unshift(
          PgWeb3.ComputeBudgetProgram.setComputeUnitLimit({
            units: opts.computeUnitLimit,
          })
        );
      }
    }

    tx.recentBlockhash = await this._getLatestBlockhash(
      connection,
      opts?.forceFetchLatestBlockhash
    );
    tx.feePayer = wallet.publicKey;

    // Add keypair signers
    if (opts?.keypairSigners?.length) tx.partialSign(...opts.keypairSigners);

    // Add wallet signers
    if (opts?.walletSigners) {
      for (const walletSigner of opts.walletSigners) {
        tx = await walletSigner.signTransaction(tx);
      }
    }

    // Sign with the current wallet as it's always the fee payer
    tx = await wallet.signTransaction(tx);

    return { connection, tx };
  }

  /**
   * Get the latest blockhash from the cache or fetch the latest if the cached
   * blockhash has expired.
   *
   * @param conn `Connection` object to use
   * @param force whether to force fetch the latest blockhash
   * @returns the latest blockhash
   */
  private static async _getLatestBlockhash(
    conn: PgWeb3.Connection,
    force?: boolean
  ) {
    return await PgCommon.getCachedValue(
      this,
      "blockhash",
      () => conn.getLatestBlockhash().then(({ blockhash }) => blockhash),
      // Blockhashes are valid for 150 slots, optimal block time is ~400ms
      // For finalized: (150 - 32) * 0.4 = 47.2s ~= 45s (to be safe)
      45,
      force
    );
  }

  /**
   * Get the priority fee information from the cache or fetch the latest if the
   * cache has expired.
   *
   * @param conn `Connection` object to use
   * @returns the priority fee information
   */
  private static async _getPriorityFee(conn: PgWeb3.Connection) {
    return await PgCommon.getCachedValue(
      this,
      "priority-fee",
      async () => {
        const result = await conn.getRecentPrioritizationFees();
        const fees = result.map((fee) => fee.prioritizationFee).sort();
        return {
          min: Math.min(...fees),
          max: Math.max(...fees),
          average: Math.ceil(
            fees.reduce((acc, cur) => acc + cur, 0) / fees.length
          ),
          median: fees[Math.floor(fees.length / 2)],
        };
      },
      // There is no perfect way to estimate for how long the priority fee will
      // be valid since it's a guess about the future based on past data
      60
    );
  }
}
