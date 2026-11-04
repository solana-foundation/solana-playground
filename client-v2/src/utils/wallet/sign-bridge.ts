// @vitest-environment node -- noble checks `instanceof Uint8Array`, which jsdom's realm fails

import * as ed25519 from "@noble/ed25519";

import type { FromSandbox, SignReply } from "../js-runtime/protocol";
import { PgWeb3 } from "../web3";
import type { Wallet } from "./types";

/** A sign request from the project-code sandbox */
type SignRequest = Pick<
  Extract<FromSandbox, { type: "sign" }>,
  "publicKey" | "kind" | "bytes"
>;

/** The reason a wallet failed to sign, without anything it was given */
const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : "The wallet refused to sign";

/**
 * Signs for the sandbox with the page's wallets: the local provider's for a
 * built-in account, the connected standard wallet for `pg.wallets.<name>`.
 * Only the signature goes back, and only once it verifies against the bytes
 * the sandbox asked about, so a wallet that changed the transaction cannot
 * hand back a signature for something else.
 *
 * A transaction comes as its serialized message, legacy or v0, and is
 * signed as a `VersionedTransaction`, which both kinds of wallet take.
 *
 * @param walletsOf the wallets the page holds now
 * @returns a function of the request, resolving with the signature or the
 * reason it was refused
 */
export const signRequestWith =
  (walletsOf: () => Wallet[]) =>
  async (request: SignRequest): Promise<SignReply> => {
    try {
      const wallet = walletsOf().find(
        (candidate) => candidate.publicKey.toBase58() === request.publicKey
      );
      // The public key names the account; it is not key material
      if (!wallet) return { error: `No key for account ${request.publicKey}` };

      let signature: Uint8Array;
      if (request.kind === "message") {
        signature = await wallet.signMessage(request.bytes);
      } else {
        const message = PgWeb3.VersionedMessage.deserialize(request.bytes);
        const signed = await wallet.signTransaction(
          new PgWeb3.VersionedTransaction(message)
        );
        const index = signed.message.staticAccountKeys.findIndex((key) =>
          key.equals(wallet.publicKey)
        );
        if (index < 0) {
          return {
            error: `Account ${request.publicKey} is not a signer of the transaction`,
          };
        }
        signature = signed.signatures[index];
      }

      const isValid = await ed25519.verify(
        signature,
        request.bytes,
        wallet.publicKey.toBytes()
      );
      if (!isValid) {
        return {
          error: `The wallet's signature for ${request.publicKey} does not match the transaction it was asked to sign`,
        };
      }
      return { signature: Uint8Array.from(signature) };
    } catch (error) {
      return { error: reasonOf(error) };
    }
  };

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/wallet/sign-bridge", () => {
    const request = {
      publicKey: PgWeb3.Keypair.generate().publicKey.toBase58(),
      kind: "message" as const,
      bytes: new Uint8Array([1, 2, 3]),
    };

    it("answers with the reason when the page's wallets cannot be listed", async () => {
      const reply = await signRequestWith(() => {
        throw new Error("Wallet not connected");
      })(request);
      expect(reply).toEqual({ error: "Wallet not connected" });
    });
  });
}
