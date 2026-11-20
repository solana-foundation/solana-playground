// @vitest-environment node -- noble checks `instanceof Uint8Array`, which jsdom's realm fails

import * as ed25519 from "@noble/ed25519";
import { getCompiledTransactionMessageDecoder } from "@solana/kit";

import { createLogger } from "../../shared/lib/logger";
import type { FromSandbox, SignReply } from "../js-runtime/protocol";
import { PgWeb3 } from "../web3";
import type { Wallet } from "./types";

const log = createLogger("wallet:sign-bridge");

/** A sign request from the project-code sandbox */
type SignRequest = Pick<
  Extract<FromSandbox, { type: "sign" }>,
  "publicKey" | "kind" | "bytes"
>;

/** The reason a wallet failed to sign, without anything it was given */
const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : "The wallet refused to sign";

/**
 * The transaction message in `bytes`, read with Kit, which knows every
 * version; nothing when the bytes are not one. Only the reason's name is
 * logged: the bytes are the sandbox's, and may be anything.
 */
const compiledMessageOf = (bytes: Uint8Array) => {
  try {
    return getCompiledTransactionMessageDecoder().decode(bytes);
  } catch (error) {
    log.warn("sign request: the transaction message could not be read", {
      context: { reason: error instanceof Error ? error.name : typeof error },
    });
    return undefined;
  }
};

/**
 * Signs for the sandbox with the page's wallets: the page's signer provider's
 * for a built-in account, the connected standard wallet for `pg.wallets.<name>`.
 * Only the signature goes back, and only once it verifies against the bytes
 * the sandbox asked about, so a wallet that changed the transaction cannot
 * hand back a signature for something else.
 *
 * A transaction comes as its serialized message, read with Kit. A legacy or
 * v0 one is signed as a `VersionedTransaction`, which both kinds of wallet
 * take. A v1 one, which web3.js cannot read, is signed by the built-in wallet
 * over its message bytes, as Kit's own signers do; a browser wallet is
 * refused, since it takes only web3.js transactions here.
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
        const compiled = compiledMessageOf(request.bytes);
        if (!compiled) {
          return { error: "The transaction's message could not be read" };
        }
        // The signers are the first static accounts, in signature order
        const index = compiled.staticAccounts
          .slice(0, compiled.header.numSignerAccounts)
          .findIndex((account) => account === request.publicKey);
        if (index < 0) {
          return {
            error: `Account ${request.publicKey} is not a signer of the transaction`,
          };
        }

        if (compiled.version === 1) {
          if (!wallet.isPg) {
            // TODO: a Wallet Standard wallet that lists v1 among its
            // `supportedTransactionVersions` could sign it; the adapter takes
            // web3.js transactions only, so it is refused for now
            return { error: `${wallet.name} cannot sign a v1 transaction` };
          }
          signature = await wallet.signTransactionBytes(request.bytes);
        } else {
          const message = PgWeb3.VersionedMessage.deserialize(request.bytes);
          const signed = await wallet.signTransaction(
            new PgWeb3.VersionedTransaction(message)
          );
          signature = signed.signatures[index];
        }
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
  const { beforeAll, describe, it, expect, vi } = import.meta.vitest;

  describe("utils/wallet/sign-bridge", () => {
    let kit: typeof import("@solana/kit");
    let localSignerProviderWith: typeof import("./signer-provider").localSignerProviderWith;
    beforeAll(async () => {
      kit = await import("@solana/kit");
      ({ localSignerProviderWith } = await import("./signer-provider"));
    });

    const request = {
      publicKey: PgWeb3.Keypair.generate().publicKey.toBase58(),
      kind: "message" as const,
      bytes: new Uint8Array([1, 2, 3]),
    };

    const keypair = PgWeb3.Keypair.generate();
    const other = PgWeb3.Keypair.generate();
    const blockhash = PgWeb3.Keypair.generate().publicKey.toBase58();

    /** A v0 transfer of `lamports` paid by `payer`, as its message bytes */
    const transferMessageWith = (lamports: number) => (payer: PgWeb3.Keypair) =>
      new PgWeb3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          PgWeb3.SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: other.publicKey,
            lamports,
          }),
        ],
      }).compileToV0Message();

    /** A wallet as `keypair` whose `signTransaction` the test supplies */
    const walletWith = (
      signTransaction: (
        tx: PgWeb3.VersionedTransaction
      ) => Promise<PgWeb3.VersionedTransaction>
    ) =>
      ({
        isPg: true,
        name: "Wallet 1",
        publicKey: keypair.publicKey,
        signTransaction,
      } as unknown as Wallet);

    const transactionRequest = (bytes: Uint8Array) => ({
      publicKey: keypair.publicKey.toBase58(),
      kind: "transaction" as const,
      bytes,
    });

    it("refuses a signature for a transaction the wallet changed", async () => {
      const asked = transferMessageWith(1)(keypair).serialize();
      // The wallet signs a transfer of more than it was asked to
      const wallet = walletWith(async () => {
        const changed = new PgWeb3.VersionedTransaction(
          transferMessageWith(1_000_000)(keypair)
        );
        changed.sign([keypair]);
        return changed;
      });

      const reply = await signRequestWith(() => [wallet])(
        transactionRequest(asked)
      );

      expect(reply).toEqual({
        error: expect.stringContaining(
          "does not match the transaction it was asked to sign"
        ),
      });
    });

    it("refuses to sign a transaction the account is not a signer of", async () => {
      const asked = transferMessageWith(1)(other).serialize();
      const wallet = walletWith(async (tx) => tx);

      const reply = await signRequestWith(() => [wallet])(
        transactionRequest(asked)
      );

      expect(reply).toEqual({
        error: `Account ${keypair.publicKey.toBase58()} is not a signer of the transaction`,
      });
    });

    it("hands back the signature of a transaction signed as asked", async () => {
      const asked = transferMessageWith(1)(keypair).serialize();
      const wallet = walletWith(async (tx) => {
        tx.sign([keypair]);
        return tx;
      });

      const reply = await signRequestWith(() => [wallet])(
        transactionRequest(asked)
      );

      expect("signature" in reply && reply.signature).toHaveLength(64);
    });

    it("signs the message bytes Kit compiles, as the sandbox's Kit signer sends them", async () => {
      const message = kit.pipe(
        kit.createTransactionMessage({ version: 0 }),
        (m) =>
          kit.setTransactionMessageFeePayer(
            kit.address(keypair.publicKey.toBase58()),
            m
          ),
        (m) =>
          kit.setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: kit.blockhash(blockhash), lastValidBlockHeight: 1n },
            m
          )
      );
      // Kit brands its bytes as a read-only array this TypeScript lib does not
      // see as array-like; they are a Uint8Array
      const bytes = Uint8Array.from(
        kit.compileTransaction(message)
          .messageBytes as unknown as ArrayLike<number>
      );
      const wallet = walletWith(async (tx) => {
        tx.sign([keypair]);
        return tx;
      });

      const reply = await signRequestWith(() => [wallet])(
        transactionRequest(bytes)
      );

      if (!("signature" in reply)) throw new Error(`refused: ${reply.error}`);
      expect(
        await ed25519.verify(
          Uint8Array.from(reply.signature),
          bytes,
          keypair.publicKey.toBytes()
        )
      ).toBe(true);
    });

    /** Kit's message bytes of an empty v1 message paid by `payer` */
    const kitV1MessageBytesOf = (
      payer: InstanceType<typeof PgWeb3.PublicKey>
    ) => {
      const message = kit.pipe(
        kit.createTransactionMessage({ version: 1 }),
        (m) =>
          kit.setTransactionMessageFeePayer(kit.address(payer.toBase58()), m),
        (m) =>
          kit.setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: kit.blockhash(blockhash), lastValidBlockHeight: 1n },
            m
          )
      );
      // Kit brands its bytes as a read-only array this TypeScript lib does
      // not see as array-like; they are a Uint8Array
      return Uint8Array.from(
        kit.compileTransaction(message)
          .messageBytes as unknown as ArrayLike<number>
      );
    };

    /** The built-in wallet as `keypair`: it signs any message bytes */
    const builtInWallet = () =>
      ({
        isPg: true,
        name: "Wallet 1",
        publicKey: keypair.publicKey,
        signTransaction: async () => {
          throw new Error("web3.js has no v1 transaction");
        },
        signTransactionBytes: (bytes: Uint8Array) =>
          ed25519.sign(bytes, keypair.secretKey.slice(0, 32)),
      } as unknown as Wallet);

    it("signs a Kit v1 transaction with the built-in wallet", async () => {
      const bytes = kitV1MessageBytesOf(keypair.publicKey);
      expect(bytes[0]).toBe(0x81);

      const reply = await signRequestWith(() => [builtInWallet()])(
        transactionRequest(bytes)
      );

      if (!("signature" in reply)) throw new Error(`refused: ${reply.error}`);
      expect(
        await ed25519.verify(
          Uint8Array.from(reply.signature),
          bytes,
          keypair.publicKey.toBytes()
        )
      ).toBe(true);
    });

    it("refuses a v1 transaction the account is not a signer of", async () => {
      const bytes = kitV1MessageBytesOf(other.publicKey);

      const reply = await signRequestWith(() => [builtInWallet()])(
        transactionRequest(bytes)
      );

      expect(reply).toEqual({
        error: `Account ${keypair.publicKey.toBase58()} is not a signer of the transaction`,
      });
    });

    it("refuses a v1 transaction for a browser wallet, which takes web3.js transactions", async () => {
      const bytes = kitV1MessageBytesOf(keypair.publicKey);
      const phantom = {
        isPg: false,
        name: "Phantom",
        publicKey: keypair.publicKey,
        signTransaction: async (tx: PgWeb3.VersionedTransaction) => tx,
      } as unknown as Wallet;

      const reply = await signRequestWith(() => [phantom])(
        transactionRequest(bytes)
      );

      expect(reply).toEqual({
        error: "Phantom cannot sign a v1 transaction",
      });
    });

    it("signs a Kit v1 transaction with a wallet of the local provider", async () => {
      const bytes = kitV1MessageBytesOf(keypair.publicKey);
      const wallet = localSignerProviderWith(() =>
        Array.from(keypair.secretKey)
      ).walletFor({ name: "Wallet 1", publicKey: keypair.publicKey });

      const reply = await signRequestWith(() => [wallet])(
        transactionRequest(bytes)
      );

      if (!("signature" in reply)) throw new Error(`refused: ${reply.error}`);
      expect(
        await ed25519.verify(
          Uint8Array.from(reply.signature),
          bytes,
          keypair.publicKey.toBytes()
        )
      ).toBe(true);
    });

    it("refuses bytes that are not a transaction message, signing nothing", async () => {
      const signTransactionBytes = vi.fn();
      const wallet = {
        isPg: true,
        name: "Wallet 1",
        publicKey: keypair.publicKey,
        signTransactionBytes,
      } as unknown as Wallet;

      const reply = await signRequestWith(() => [wallet])(
        transactionRequest(new Uint8Array([0x81]))
      );

      expect(reply).toEqual({
        error: "The transaction's message could not be read",
      });
      expect(signTransactionBytes).not.toHaveBeenCalled();
    });

    it("answers with the reason when the page's wallets cannot be listed", async () => {
      const reply = await signRequestWith(() => {
        throw new Error("Wallet not connected");
      })(request);
      expect(reply).toEqual({ error: "Wallet not connected" });
    });
  });
}
