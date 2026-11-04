// Runs inside the project-code sandbox (`runtime.html`): it imports web3.js
// itself, never `../web3` or the page's wallet, which read the page's storage.
import {
  Keypair,
  type PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

import type { SignKind } from "../js-runtime/protocol";
import type { SignerAccount, WalletSignerProvider } from "./signer-provider";
import type { AnyTransaction, PlaygroundWallet } from "./types";

/**
 * Asks the page to sign: as an account, what kind of bytes, then the bytes.
 * Resolves with the 64-byte signature, or rejects with the page's refusal.
 */
export type SignThroughPage = (
  publicKey: PublicKey
) => (kind: SignKind) => (bytes: Uint8Array) => Promise<Uint8Array>;

/**
 * Where a sandbox keypair keeps the function that has the page sign a
 * transaction message as it. The web3.js patch (`js-runtime/sandbox/
 * placeholders.ts`) reads it to tell a sandbox keypair from a real one.
 */
export const SIGN_THROUGH_PAGE = Symbol("pg.signThroughPage");

/** A keypair whose signatures the page makes */
export type SandboxKeypair = Keypair & {
  [SIGN_THROUGH_PAGE]: (bytes: Uint8Array) => Promise<Uint8Array>;
};

/** What reading `secretKey` throws inside the sandbox */
export const SECRET_KEY_ERROR =
  "pg.wallet.keypair.secretKey is not available: project code runs in a sandbox " +
  "that never holds the wallet's key. Sign with `await tx.sign(pg.wallet.keypair)`, " +
  "pg.wallet.signTransaction(tx) or pg.wallet.signMessage(message) instead.";

/** Whether a signer is a sandbox keypair */
export const isSandboxKeypair = (signer: unknown): signer is SandboxKeypair =>
  typeof signer === "object" && signer !== null && SIGN_THROUGH_PAGE in signer;

/**
 * A keypair-shaped stand-in for an account: an instance of web3.js `Keypair`
 * with the account's public key, whose `secretKey` throws. Signing with it
 * through web3.js goes to the page (`placeholders.ts`).
 *
 * @param sign asks the page to sign
 * @returns a function of the account's public key
 */
export const sandboxKeypairWith =
  (sign: SignThroughPage) =>
  (publicKey: PublicKey): SandboxKeypair =>
    Object.create(Keypair.prototype, {
      publicKey: { value: publicKey, enumerable: true },
      secretKey: {
        enumerable: true,
        get() {
          throw new Error(SECRET_KEY_ERROR);
        },
      },
      [SIGN_THROUGH_PAGE]: { value: sign(publicKey)("transaction") },
    });

/**
 * The signing methods of a wallet whose key the page holds.
 *
 * @param sign asks the page to sign
 * @returns a function of the account's public key
 */
export const signerMethodsWith =
  (sign: SignThroughPage) => (publicKey: PublicKey) => {
    const signTransaction = async <T extends AnyTransaction>(tx: T) => {
      // `version` is `0` on a v0 transaction, so test for the field
      const bytes =
        "version" in tx
          ? (tx as VersionedTransaction).message.serialize()
          : (tx as Transaction).serializeMessage();
      const signature = await sign(publicKey)("transaction")(bytes);
      tx.addSignature(publicKey, Buffer.from(signature));
      return tx;
    };

    return {
      signTransaction,
      async signAllTransactions<T extends AnyTransaction>(txs: T[]) {
        for (const tx of txs) await signTransaction(tx);
        return txs;
      },
      signMessage: (message: Uint8Array) => sign(publicKey)("message")(message),
    };
  };

/**
 * The signer provider of the sandbox: its wallets sign by asking the page,
 * which signs with its local provider. It never holds a key, so asking it
 * for key bytes throws.
 *
 * @param sign asks the page to sign
 * @returns the sandbox signer provider
 */
export const sandboxSignerProviderWith = (
  sign: SignThroughPage
): WalletSignerProvider => ({
  name: "sandbox",
  walletFor(account: SignerAccount): PlaygroundWallet {
    return {
      isPg: true,
      keypair: sandboxKeypairWith(sign)(account.publicKey),
      name: account.name,
      publicKey: account.publicKey,
      ...signerMethodsWith(sign)(account.publicKey),
    };
  },
  secretKeyFor() {
    throw new Error(SECRET_KEY_ERROR);
  },
});
