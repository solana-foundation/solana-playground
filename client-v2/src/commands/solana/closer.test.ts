/**
 * @vitest-environment node
 */
// A file of its own: web3.js's buffer layouts reject the `Uint8Array` of
// jsdom's realm, so this one runs in Node's.
import {
  address,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  getPublicKeyFromAddress,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  verifySignature,
} from "@solana/kit";
import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { toBytes } from "./bytes";
import { getCloser } from "./closer";

describe("commands/solana/closer", () => {
  describe("getCloser", () => {
    it("signs the message it is given with the wallet's key", async () => {
      const keypair = Keypair.generate();
      const feePayer = address(keypair.publicKey.toBase58());
      const wallet = {
        publicKey: keypair.publicKey,
        signTransaction: async (transaction: VersionedTransaction) => {
          transaction.sign([keypair]);
          return transaction;
        },
      };
      const message = pipe(
        createTransactionMessage({ version: "legacy" }),
        (m) => setTransactionMessageFeePayer(feePayer, m),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            {
              // eslint-disable-next-line no-restricted-syntax -- a made-up blockhash of the right shape
              blockhash:
                "63UDxww7u4xxzCYo3CgLyBEqXYNkwJ6n9RSdVCDm7b98" as Blockhash,
              lastValidBlockHeight: 1n,
            },
            m
          )
      );
      const wire = toBytes(
        getTransactionEncoder().encode(compileTransaction(message))
      );

      const closer = getCloser(wallet);
      const signedWire = await closer.sign(Uint8Array.from(wire));

      expect(closer.address).toBe(keypair.publicKey.toBase58());
      // [signature count][signature][message]: the message stays as it was
      expect(Array.from(signedWire.slice(65))).toEqual(
        Array.from(wire.slice(65))
      );
      const signature = signedWire.slice(1, 65);
      const publicKey = await getPublicKeyFromAddress(
        closer.address as Parameters<typeof getPublicKeyFromAddress>[0]
      );
      expect(
        await verifySignature(
          publicKey,
          signature as Parameters<typeof verifySignature>[1],
          signedWire.slice(65)
        )
      ).toBe(true);
    });
  });
});
