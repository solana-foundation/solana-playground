import { PgTx, PgWeb3 } from "@/utils";
import type { StandardWallet } from "@/utils/wallet/types";

/**
 * The cluster ran the transfer and it failed, so no SOL moved; a retry is
 * safe. `classify` reads this name as a network failure.
 */
export class TransferFailedError extends Error {
  override name = "TransferFailedError";
}

/**
 * The transfer was sent but its confirmation never came, so it may have
 * landed; a retry could pay twice. `classify` reads this name as
 * `unconfirmed`.
 */
export class TransferNotConfirmedError extends Error {
  override name = "TransferNotConfirmedError";

  constructor(readonly signature: string, cause: unknown) {
    super(
      `Sent as ${signature}, not confirmed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
  }
}

/**
 * Moves `lamports` from the connected `payer` to `to` with one System Program
 * transfer the payer signs, on the Playground's own cluster: `PgTx.send` takes
 * the blockhash, fee payer, priority fee and RPC from the Playground, so the
 * transfer lands where `deploy` will look for it.
 *
 * @returns the confirmed signature
 * @throws what `PgTx.send` throws while nothing was sent, then
 * `TransferNotConfirmedError` or `TransferFailedError`
 */
export const sendFunds = async ({
  payer,
  to,
  lamports,
}: {
  payer: StandardWallet<true>;
  to: string;
  lamports: number;
}) => {
  const transfer = PgWeb3.SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: new PgWeb3.PublicKey(to),
    lamports,
  });
  const signature = await PgTx.send(transfer, { wallet: payer });
  let result: Awaited<ReturnType<typeof PgTx.confirm>>;
  try {
    result = await PgTx.confirm(signature);
  } catch (error: unknown) {
    throw new TransferNotConfirmedError(signature, error);
  }
  if (result?.err) {
    throw new TransferFailedError(
      `The cluster refused the transfer: ${JSON.stringify(result.err)}`
    );
  }
  return signature;
};
