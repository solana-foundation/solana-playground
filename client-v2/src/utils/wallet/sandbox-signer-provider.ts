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

/** Whether a value is a list of byte values (integers 0 to 255) */
const isByteList = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);

/**
 * The message project code asked to sign, as bytes the page accepts: a
 * `Uint8Array` (a `Buffer` is one) or a `number[]` of byte values.
 *
 * @param message what project code passed to `signMessage`
 * @returns a copy of its bytes
 * @throws a `TypeError` naming what to pass instead, for anything else
 */
const messageBytesOf = (message: unknown): Uint8Array => {
  if (message instanceof Uint8Array || isByteList(message)) {
    return Uint8Array.from(message);
  }
  throw new TypeError(
    `signMessage takes the message as bytes (a Uint8Array, Buffer or number[]), not ${
      Array.isArray(message) ? "an array of non-bytes" : typeof message
    }. Encode text first: new TextEncoder().encode(text).`
  );
};

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
      signMessage: async (message: Uint8Array) =>
        sign(publicKey)("message")(messageBytesOf(message)),
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

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/wallet/sandbox-signer-provider", () => {
    const publicKey = Keypair.generate().publicKey;

    /** Signer methods whose "page" records the bytes it is asked to sign */
    const recordingMethods = () => {
      const asked: Array<number[] | string> = [];
      const methods = signerMethodsWith(() => () => async (bytes) => {
        // Only a `Uint8Array` passes the page's check of a sign request
        asked.push(
          bytes instanceof Uint8Array ? Array.from(bytes) : "not bytes"
        );
        return new Uint8Array(64);
      })(publicKey);
      return { methods, asked };
    };

    it("signMessage sends a Uint8Array, a Buffer or a number[] as bytes", async () => {
      const { methods, asked } = recordingMethods();
      await methods.signMessage(new Uint8Array([1, 2]));
      await methods.signMessage(Buffer.from([3, 4]));
      await methods.signMessage([5, 6] as unknown as Uint8Array);
      expect(asked).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
    });

    it("signMessage refuses a string or other non-bytes without asking the page", async () => {
      const { methods, asked } = recordingMethods();
      await expect(
        methods.signMessage("hello" as unknown as Uint8Array)
      ).rejects.toThrow("signMessage takes the message as bytes");
      await expect(
        methods.signMessage([1, 256] as unknown as Uint8Array)
      ).rejects.toThrow("signMessage takes the message as bytes");
      expect(asked).toEqual([]);
    });
  });
}
