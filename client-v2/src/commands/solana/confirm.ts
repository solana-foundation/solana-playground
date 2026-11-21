import { isSignature, signature as toSignature } from "@solana/kit";

import { TerminalLineError } from "../../utils/terminal/line-error";
import type { SolanaClient } from "./client";
import { describeError } from "./describe-error";
import { printTransaction, type TransactionDetails } from "./print-transaction";
import { type SignatureStatus, toSignatureStatus } from "./signature-status";
import { formatTransactionError } from "./transaction-error";

/** What the CLI says for a signature it cannot parse, without asking the cluster */
const INVALID_SIGNATURE = "Parse error: Bad parameter: Invalid signature";

/** `Finalized` for `finalized`, as Rust's `Debug` of the status prints it */
const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** The status line: "Not found", "Transaction failed: <error>", or the confirmation level, capitalized */
const formatStatus = (status: SignatureStatus | undefined) => {
  if (!status?.confirmationStatus) return "Not found";
  if (status.err !== undefined) {
    return `Transaction failed: ${formatTransactionError(status.err)}`;
  }
  return capitalize(status.confirmationStatus);
};

/** The banner `solana confirm -v` prints before anything else, as `process_command` of the Rust CLI did */
const bannerOf = (client: SolanaClient) =>
  `RPC URL: ${client.url}\nDefault Signer: Playground Wallet\nCommitment: ${client.commitment}`;

/**
 * Ask the cluster for a signature's status, searching its transaction history:
 * without it a signature older than the status cache (about two minutes) reads
 * "Not found".
 *
 * @returns the status, or `undefined` for a signature the cluster does not know
 * @throws {TerminalLineError} when the signature cannot be parsed
 * @throws {Error} when the cluster cannot be asked
 */
const fetchStatus = async (client: SolanaClient, signature: string) => {
  if (!isSignature(signature)) throw new TerminalLineError(INVALID_SIGNATURE);

  try {
    const { value } = await client.rpc
      .getSignatureStatuses([toSignature(signature)], {
        searchTransactionHistory: true,
      })
      .send();
    return toSignatureStatus(value[0]);
  } catch (e) {
    throw new Error(`Unable to confirm: ${describeError(e)}`, { cause: e });
  }
};

/**
 * `solana confirm <signature>`.
 *
 * @param client the cluster to ask
 * @returns a function from the signature to the lines the CLI printed
 */
export const confirmWith =
  (client: SolanaClient) => async (signature: string) =>
    [formatStatus(await fetchStatus(client, signature))];

/** The line the CLI prints above the status when the transaction cannot be shown */
const unableToGet = (reason: string) =>
  `\nUnable to get finalized transaction details: ${reason}\n`;

/**
 * `solana confirm -v <signature>`: the banner, then the transaction, then the status.
 *
 * @param client the cluster to ask
 * @returns a function from the signature to the lines the CLI printed
 */
export const confirmVerboseWith =
  (client: SolanaClient) => async (signature: string) => {
    const status = await fetchStatus(client, signature);

    let body = "";
    if (status?.confirmationStatus) {
      let details: TransactionDetails | undefined;
      let failure: string | undefined;
      try {
        details = await fetchTransactionDetails(client, signature);
      } catch (e) {
        failure = describeError(e);
      }

      if (failure !== undefined) {
        body += unableToGet(failure);
      } else if (details) {
        body += printTransaction(details);
      } else if (status.confirmationStatus === "finalized") {
        body += unableToGet("Transaction not found");
      } else {
        body += unableToGet("not yet finalized");
      }
    }
    body += `\n${formatStatus(status)}`;

    return [bannerOf(client), body];
  };

/**
 * The transaction as `getTransaction` returns it, with the `null`s of the
 * wire turned into absent fields.
 *
 * @returns the transaction, or `undefined` when the cluster has none by that signature
 * @throws {Error} when the cluster cannot be asked
 */
const fetchTransactionDetails = async (
  client: SolanaClient,
  signature: string
): Promise<TransactionDetails | undefined> => {
  const transaction = await client.rpc
    .getTransaction(toSignature(signature), {
      commitment:
        client.commitment === "processed" ? "confirmed" : client.commitment,
      encoding: "base64",
      maxSupportedTransactionVersion: 0,
    })
    .send();
  if (!transaction) return undefined;

  const { meta } = transaction;
  return {
    slot: transaction.slot,
    blockTime: transaction.blockTime ?? undefined,
    transaction: transaction.transaction[0],
    meta: meta
      ? {
          err: meta.err ?? undefined,
          fee: meta.fee,
          preBalances: meta.preBalances,
          postBalances: meta.postBalances,
          logMessages: meta.logMessages ?? undefined,
          returnData: meta.returnData ?? undefined,
          rewards: meta.rewards?.map((reward) => ({
            pubkey: reward.pubkey,
            lamports: reward.lamports,
            postBalance: reward.postBalance,
            rewardType: reward.rewardType ?? undefined,
          })),
        }
      : undefined,
  };
};
