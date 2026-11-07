// @vitest-environment node -- noble and web3 check `instanceof Uint8Array`, which jsdom's realm fails

import {
  sandboxKeypairWith,
  signerMethodsWith,
  type SignThroughPage,
} from "../sandbox-signer-provider";
import type { WalletSignerProvider } from "../signer-provider";
import type { KeyFrame } from "./client";
import { createdKeyOf, signatureOf } from "./protocol";

/** What the WASM CLIs get in place of the built-in wallet's key bytes */
export const CLI_KEY_ERROR =
  "The built-in wallet's key is kept on its own origin, so the solana, spl-token and anchor commands cannot sign with it. Connect a wallet, or use the Deploy button.";

/**
 * The signer provider that keeps the built-in wallet's keys on the key origin:
 * the key page makes, stores and drops them and signs with them, and the page
 * only ever holds public keys. Its wallets are the sandbox's (a keypair whose
 * `secretKey` throws, signing that asks for a signature), with the key page
 * as the one asked.
 *
 * @param frame the connection to the key page, made on first use
 * @returns the key-origin signer provider
 */
export const keyOriginSignerProvider = (
  frame: () => Promise<KeyFrame>
): WalletSignerProvider => {
  const sign: SignThroughPage = (publicKey) => (kind) => (bytes) =>
    frame()
      .then((link) =>
        link.request<unknown>({
          type: "sign",
          publicKey: publicKey.toBase58(),
          kind,
          bytes,
        })
      )
      .then(signatureOf);
  return {
    name: "key-origin",
    holdsKeysInPage: false,
    walletFor(account) {
      return {
        isPg: true,
        keypair: sandboxKeypairWith(sign)(account.publicKey),
        name: account.name,
        publicKey: account.publicKey,
        ...signerMethodsWith(sign)(account.publicKey),
      };
    },
    secretKeyFor() {
      throw new Error(CLI_KEY_ERROR);
    },
    // The key page stores the key at once: the panel that offers the new
    // key's file is a second key page instance with its own memory, so it
    // sees only the store. A key no account takes is dropped with `forgetKey`.
    async makeKey() {
      return createdKeyOf(await (await frame()).request({ type: "create" }));
    },
    async forgetKey(publicKey) {
      await (await frame()).request({ type: "forget", publicKey });
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/wallet/key-origin/provider", async () => {
    const ed25519 = await import("@noble/ed25519");
    const { PgWeb3 } = await import("../../web3");
    const { SECRET_KEY_ERROR } = await import("../sandbox-signer-provider");
    const { handlerWith } = await import("./frame/handler");
    const { KeyFrameUnavailable } = await import("./client");

    /** A key page over an in-memory store, reached as a `KeyFrame` */
    const fakeKeyPage = () => {
      const kept = new Map<string, Uint8Array>();
      const handle = handlerWith({
        all: async () => new Map(kept),
        put: async (entries) => {
          for (const [publicKey, secret] of entries)
            kept.set(publicKey, secret);
        },
        remove: async (publicKey) => {
          kept.delete(publicKey);
        },
      });
      let id = 0;
      const link: KeyFrame = {
        request: async <T>(body: Parameters<KeyFrame["request"]>[0]) => {
          const reply = await handle(
            Object.assign({ id: ++id }, body) as Parameters<typeof handle>[0]
          );
          if (!reply.ok) throw new Error(reply.error);
          return reply.result as T;
        },
        close: () => {},
      };
      const provider = keyOriginSignerProvider(async () => link);
      return { kept, provider };
    };

    const walletOf = async () => {
      const { kept, provider } = fakeKeyPage();
      const publicKey = new PgWeb3.PublicKey(await provider.makeKey());
      const wallet = provider.walletFor({ name: "Wallet 1", publicKey });
      return { kept, provider, publicKey, wallet };
    };

    const blockhash = PgWeb3.Keypair.generate().publicKey.toBase58();
    const transferFrom = (publicKey: InstanceType<typeof PgWeb3.PublicKey>) =>
      PgWeb3.SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: PgWeb3.Keypair.generate().publicKey,
        lamports: 1,
      });

    it("makeKey stores the key in the key page and gives its public key", async () => {
      const { kept, provider } = fakeKeyPage();
      const publicKey = await provider.makeKey();
      expect(Array.from(kept.keys())).toEqual([publicKey]);
      expect(provider.holdsKeysInPage).toBe(false);
      expect(provider.name).toBe("key-origin");
    });

    it("forgetKey drops the key from the key page", async () => {
      const { kept, provider } = fakeKeyPage();
      const publicKey = await provider.makeKey();
      await provider.forgetKey(publicKey);
      expect(kept.size).toBe(0);
    });

    it("signs a legacy transaction through the key page", async () => {
      const { publicKey, wallet } = await walletOf();
      const tx = new PgWeb3.Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhash,
      }).add(transferFrom(publicKey));
      await wallet.signTransaction(tx);
      expect(tx.verifySignatures()).toBe(true);
    });

    it("signs a v0 transaction through the key page", async () => {
      const { publicKey, wallet } = await walletOf();
      const tx = new PgWeb3.VersionedTransaction(
        new PgWeb3.TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: [transferFrom(publicKey)],
        }).compileToV0Message()
      );
      await wallet.signTransaction(tx);
      expect(
        await ed25519.verify(
          tx.signatures[0],
          tx.message.serialize(),
          publicKey.toBytes()
        )
      ).toBe(true);
    });

    it("signs a message through the key page", async () => {
      const { publicKey, wallet } = await walletOf();
      const message = new TextEncoder().encode("hello");
      const signature = await wallet.signMessage(message);
      expect(
        await ed25519.verify(signature, message, publicKey.toBytes())
      ).toBe(true);
    });

    it("gives a keypair whose secret key throws", async () => {
      const { publicKey, wallet } = await walletOf();
      if (!wallet.isPg) throw new Error("expected a Playground wallet");
      expect(wallet.keypair.publicKey.equals(publicKey)).toBe(true);
      expect(() => wallet.keypair.secretKey).toThrow(SECRET_KEY_ERROR);
    });

    it("secretKeyFor refuses with the CLI message", async () => {
      const { provider, publicKey } = await walletOf();
      expect(() => provider.secretKeyFor(publicKey)).toThrow(CLI_KEY_ERROR);
    });

    it("signing as an account the key page lacks fails naming it", async () => {
      const { provider } = fakeKeyPage();
      const publicKey = PgWeb3.Keypair.generate().publicKey;
      const wallet = provider.walletFor({ name: "Gone", publicKey });
      await expect(wallet.signMessage(new Uint8Array([1]))).rejects.toThrow(
        `No key for account ${publicKey.toBase58()}`
      );
    });

    it("refuses a create or sign reply of the wrong shape", async () => {
      const link: KeyFrame = {
        request: async <T>(body: Parameters<KeyFrame["request"]>[0]) =>
          (body.type === "sign" ? new Uint8Array(63) : ["pk"]) as T,
        close: () => {},
      };
      const provider = keyOriginSignerProvider(async () => link);
      await expect(provider.makeKey()).rejects.toThrow(
        "answered create with a reply of the wrong shape"
      );
      const wallet = provider.walletFor({
        name: "Wallet 1",
        publicKey: PgWeb3.Keypair.generate().publicKey,
      });
      await expect(wallet.signMessage(new Uint8Array([1]))).rejects.toThrow(
        "answered sign with a reply of the wrong shape"
      );
    });

    it("passes on an unreachable key page", async () => {
      const provider = keyOriginSignerProvider(() =>
        Promise.reject(new KeyFrameUnavailable("timeout"))
      );
      const wallet = provider.walletFor({
        name: "Wallet 1",
        publicKey: PgWeb3.Keypair.generate().publicKey,
      });
      await expect(
        wallet.signMessage(new Uint8Array([1]))
      ).rejects.toBeInstanceOf(KeyFrameUnavailable);
      await expect(provider.makeKey()).rejects.toBeInstanceOf(
        KeyFrameUnavailable
      );
    });
  });
}
