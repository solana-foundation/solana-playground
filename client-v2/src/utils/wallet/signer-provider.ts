// @vitest-environment node -- noble checks `instanceof Uint8Array`, which jsdom's realm fails

import * as ed25519 from "@noble/ed25519";

import { PgWeb3 } from "../web3";
import type { AnyTransaction, PlaygroundWallet } from "./types";

/** A built-in wallet account as the signer provider sees it: no key bytes */
export interface SignerAccount {
  /** Name of the account */
  name: string;
  /** Public key of the account, which names its key in the provider */
  publicKey: PgWeb3.PublicKey;
}

/**
 * Holds the built-in wallet's secret keys and signs with them.
 *
 * Every use of an account's key, whether to sign, to hand `pg.wallet.keypair`
 * to project code, to export the key file or to give the WASM CLIs their
 * keypair, goes through the provider, so a provider that keeps the keys out of
 * the page can replace the local one without touching those callers. The
 * wallet's `keypair` and the synchronous `secretKeyFor` are what only the local
 * provider can give as they are; a provider that keeps the keys elsewhere
 * settles what it gives in their place (HOO-1717 step 2).
 */
export interface WalletSignerProvider {
  /** Short name of the provider, for diagnostics */
  readonly name: string;
  /**
   * Whether the page holds the keys: the account record keeps `kp`, and key
   * bytes can be handed out (`secretKeyFor`)
   */
  readonly holdsKeysInPage: boolean;
  /**
   * Make a new key that `walletFor` and `secretKeyFor` find before any
   * account names it.
   *
   * @returns the key's base58 public key
   */
  makeKey(): Promise<string>;
  /**
   * Keep the key of an account just added; a key already kept stays as it is.
   *
   * @param publicKey base58 public key of the account
   */
  keepKey(publicKey: string): Promise<void>;
  /**
   * Drop the key of an account removed, or of a key made and never added.
   *
   * @param publicKey base58 public key of the key
   */
  forgetKey(publicKey: string): Promise<void>;
  /**
   * The wallet for an account: its public key, its name and the signing
   * methods.
   *
   * @throws when the provider holds no key for the account's public key
   */
  walletFor(account: SignerAccount): PlaygroundWallet;
  /**
   * The account's 64 secret key bytes (private key, then public key), for the
   * key file export and the WASM CLIs. The caller gets its own copy.
   *
   * @throws when the provider holds no key for the public key
   */
  secretKeyFor(publicKey: PgWeb3.PublicKey): Uint8Array;
}

/**
 * The public key of a stored account, read from the key's last 32 bytes.
 *
 * @param kp the account's 64 secret key bytes
 * @returns the account's public key
 */
export const publicKeyOf = (kp: number[]) =>
  new PgWeb3.PublicKey(Uint8Array.from(kp.slice(32)));

/**
 * The signer provider that keeps the keys in the page, as the wallet always
 * has: every wallet carries its `keypair`, which project code reads as
 * `pg.wallet.keypair`. A key `makeKey` made lives in memory until an account
 * stores it in the record; keeping and forgetting are the record's own.
 *
 * @param keyFor looks up an account's 64 secret key bytes by its public key
 * @returns the local signer provider
 */
export const localSignerProviderWith = (
  keyFor: (publicKey: PgWeb3.PublicKey) => number[] | undefined
): WalletSignerProvider => {
  const drafts = new Map<string, number[]>();
  const keypairFor = (publicKey: PgWeb3.PublicKey) => {
    const kp = keyFor(publicKey) ?? drafts.get(publicKey.toBase58());
    // The public key names the account; it is not key material
    if (!kp) throw new Error(`No key for account ${publicKey.toBase58()}`);
    return PgWeb3.Keypair.fromSecretKey(Uint8Array.from(kp));
  };

  return {
    name: "local",
    holdsKeysInPage: true,
    async makeKey() {
      const keypair = PgWeb3.Keypair.generate();
      const publicKey = keypair.publicKey.toBase58();
      drafts.set(publicKey, Array.from(keypair.secretKey));
      return publicKey;
    },
    async keepKey() {},
    async forgetKey() {},
    walletFor(account) {
      const keypair = keypairFor(account.publicKey);

      return {
        isPg: true,
        keypair,
        name: account.name,
        publicKey: keypair.publicKey,

        async signTransaction<T extends AnyTransaction>(tx: T) {
          // `version` is `0` on a v0 transaction, so test for the field, not
          // its value; a legacy transaction has none
          if ("version" in tx) {
            (tx as PgWeb3.VersionedTransaction).sign([keypair]);
          } else {
            (tx as PgWeb3.Transaction).partialSign(keypair);
          }

          return tx;
        },

        async signAllTransactions<T extends AnyTransaction>(txs: T[]) {
          for (const tx of txs) {
            await this.signTransaction(tx);
          }

          return txs;
        },

        async signMessage(message: Uint8Array) {
          return await ed25519.sign(message, keypair.secretKey.slice(0, 32));
        },
      };
    },
    secretKeyFor(publicKey) {
      return Uint8Array.from(keypairFor(publicKey).secretKey);
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/wallet/signer-provider", () => {
    const keypair = PgWeb3.Keypair.generate();
    const other = PgWeb3.Keypair.generate();
    const kp = Array.from(keypair.secretKey);
    const provider = localSignerProviderWith((publicKey) =>
      publicKey.equals(keypair.publicKey) ? kp : undefined
    );
    const account = { name: "Wallet 1", publicKey: keypair.publicKey };
    const blockhash = PgWeb3.Keypair.generate().publicKey.toBase58();
    const transfer = () =>
      PgWeb3.SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: other.publicKey,
        lamports: 1,
      });

    it("publicKeyOf reads the public key from the last 32 bytes", () => {
      expect(publicKeyOf(kp).equals(keypair.publicKey)).toBe(true);
    });

    it("walletFor gives the account's keypair, as pg.wallet.keypair", () => {
      const wallet = provider.walletFor(account);
      expect(wallet.isPg).toBe(true);
      expect(wallet.name).toBe("Wallet 1");
      expect(wallet.publicKey.equals(keypair.publicKey)).toBe(true);
      expect(Array.from(wallet.keypair.secretKey)).toEqual(kp);
    });

    it("walletFor refuses an account it holds no key for", () => {
      expect(() =>
        provider.walletFor({ name: "Other", publicKey: other.publicKey })
      ).toThrow(`No key for account ${other.publicKey.toBase58()}`);
    });

    it("signTransaction signs a legacy transaction", async () => {
      const tx = new PgWeb3.Transaction({
        feePayer: keypair.publicKey,
        recentBlockhash: blockhash,
      }).add(transfer());
      await provider.walletFor(account).signTransaction(tx);
      expect(tx.verifySignatures()).toBe(true);
    });

    it("signTransaction signs a versioned transaction", async () => {
      const tx = new PgWeb3.VersionedTransaction(
        new PgWeb3.TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: blockhash,
          instructions: [transfer()],
        }).compileToV0Message()
      );
      await provider.walletFor(account).signTransaction(tx);
      const signature = tx.signatures[0];
      expect(
        await ed25519.verify(
          signature,
          tx.message.serialize(),
          keypair.publicKey.toBytes()
        )
      ).toBe(true);
    });

    it("signAllTransactions signs every transaction", async () => {
      const txs = [0, 1].map(() =>
        new PgWeb3.Transaction({
          feePayer: keypair.publicKey,
          recentBlockhash: blockhash,
        }).add(transfer())
      );
      await provider.walletFor(account).signAllTransactions(txs);
      expect(txs.every((tx) => tx.verifySignatures())).toBe(true);
    });

    it("signMessage signs with the account's key", async () => {
      const message = new TextEncoder().encode("hello");
      const signature = await provider.walletFor(account).signMessage(message);
      expect(
        await ed25519.verify(signature, message, keypair.publicKey.toBytes())
      ).toBe(true);
    });

    it("secretKeyFor hands out a copy of the key", () => {
      const secretKey = provider.secretKeyFor(keypair.publicKey);
      expect(Array.from(secretKey)).toEqual(kp);
      secretKey.fill(0);
      expect(Array.from(provider.secretKeyFor(keypair.publicKey))).toEqual(kp);
    });

    it("makeKey makes a key that walletFor and secretKeyFor find", async () => {
      const publicKey = await provider.makeKey();
      const wallet = provider.walletFor({
        name: "New",
        publicKey: new PgWeb3.PublicKey(publicKey),
      });
      expect(wallet.publicKey.toBase58()).toBe(publicKey);
      const secretKey = provider.secretKeyFor(new PgWeb3.PublicKey(publicKey));
      expect(publicKeyOf(Array.from(secretKey)).toBase58()).toBe(publicKey);
      expect(provider.holdsKeysInPage).toBe(true);
    });

    it("secretKeyFor refuses a public key it holds no key for", () => {
      expect(() => provider.secretKeyFor(other.publicKey)).toThrow(
        "No key for account"
      );
    });
  });
}
