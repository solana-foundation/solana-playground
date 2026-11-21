import { VersionedTransaction } from "@solana/web3.js";

import type { BufferCloser } from "./buffers";

/** What signing needs of the wallet: its public key and a signature over a transaction */
interface CloserWallet {
  readonly publicKey: { toBase58(): string };
  signTransaction(
    transaction: VersionedTransaction
  ): Promise<VersionedTransaction>;
}

/** The wallet as the signer `program close --buffers` sends its transactions with */
export const getCloser = (wallet: CloserWallet): BufferCloser => ({
  address: wallet.publicKey.toBase58(),
  sign: async (wireTransaction) => {
    const signed = await wallet.signTransaction(
      VersionedTransaction.deserialize(wireTransaction)
    );
    return signed.serialize();
  },
});
