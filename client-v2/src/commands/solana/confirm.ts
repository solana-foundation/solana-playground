import { isSignature, signature as toSignature } from "@solana/kit";

import { TerminalLineError } from "../../utils/terminal/line-error";
import type { SolanaClient } from "./client";
import { printTransaction, type TransactionDetails } from "./print-transaction";
import { formatTransactionError } from "./transaction-error";

/** The signature's confirmation as the status line prints it, from `getSignatureStatuses`' entry */
interface SignatureStatus {
  readonly confirmationStatus?: string | null;
  readonly err: unknown;
}

/** What the CLI says for a signature it cannot parse, without asking the cluster */
const INVALID_SIGNATURE = "Parse error: Bad parameter: Invalid signature";

/** `Finalized` for `finalized`, as Rust's `Debug` of the status prints it */
const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** The status line: "Not found", "Transaction failed: <error>", or the confirmation level, capitalized */
const formatStatus = (status: SignatureStatus | null) => {
  if (!status?.confirmationStatus) return "Not found";
  if (status.err !== null) {
    return `Transaction failed: ${formatTransactionError(status.err)}`;
  }
  return capitalize(status.confirmationStatus);
};

/** The banner `solana -v` prints before anything else, as `process_command` of the Rust CLI did */
const bannerOf = (client: SolanaClient) =>
  `RPC URL: ${client.url}\nDefault Signer: Playground Wallet\nCommitment: ${client.commitment}`;

/**
 * Ask the cluster for a signature's status, searching its transaction history:
 * without it a signature older than the status cache (about two minutes) reads
 * "Not found". The wasm CLI asked without it; the native CLI asks with it.
 *
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
    return value[0];
  } catch (e) {
    throw new Error(`Unable to confirm: ${errorMessage(e)}`, { cause: e });
  }
};

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

/**
 * `solana confirm <signature>`.
 *
 * @param client the cluster to ask
 * @returns a function from the signature to the lines the CLI printed
 */
export const confirmWith =
  (client: SolanaClient) => async (signature: string) =>
    [formatStatus(await fetchStatus(client, signature))];

/**
 * `solana confirm -v <signature>`: the banner, then the transaction, then the status.
 *
 * @param client the cluster to ask
 * @returns a function from the signature to the lines the CLI printed
 */
export const confirmVerboseWith =
  (client: SolanaClient) => async (signature: string) => {
    const status = await fetchStatus(client, signature);

    let transaction: string | undefined;
    let failure: string | undefined;
    if (status?.confirmationStatus) {
      try {
        transaction = await fetchTransactionText(client, signature);
      } catch (e) {
        failure = errorMessage(e);
      }
    }

    let body = "";
    if (transaction !== undefined) {
      body += transaction;
    } else if (status?.confirmationStatus) {
      if (status.confirmationStatus !== "finalized") {
        body +=
          "\nUnable to get finalized transaction details: not yet finalized\n";
      } else if (failure !== undefined) {
        body += `\nUnable to get finalized transaction details: ${failure}\n`;
      }
    }
    body += `\n${formatStatus(status)}`;

    return [bannerOf(client), body];
  };

/**
 * The transaction as `getTransaction` returns it, printed.
 *
 * @throws {Error} when the cluster has no such transaction or cannot be asked
 */
const fetchTransactionText = async (
  client: SolanaClient,
  signature: string
) => {
  const transaction = await client.rpc
    .getTransaction(toSignature(signature), {
      commitment:
        client.commitment === "processed" ? "confirmed" : client.commitment,
      encoding: "base64",
      maxSupportedTransactionVersion: 0,
    })
    .send();
  if (!transaction) throw new Error("Transaction not found");

  const details: TransactionDetails = {
    slot: transaction.slot,
    blockTime: transaction.blockTime,
    transaction: transaction.transaction[0],
    meta: transaction.meta,
  };
  return printTransaction(details);
};
