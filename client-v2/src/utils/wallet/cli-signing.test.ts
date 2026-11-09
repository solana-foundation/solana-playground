// @vitest-environment node -- noble checks `instanceof Uint8Array`, which jsdom's realm fails
//
// Under the key origin the WASM CLIs sign the built-in wallet's slot through
// `PgWallet` at the send step, never with its key bytes
// (`wasm/utils/solana-playground-utils`, `wallet.rs`).
import * as ed25519 from "@noble/ed25519";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PgWeb3 } from "../web3";
import { localSignerProviderWith } from "./signer-provider";
import type { AnyTransaction, Wallet } from "./types";
import { PgWallet } from "./wallet";

// The connection module reads build-time globals the unit runner does not
// define; signing never touches it.
vi.mock("../connection", () => ({ PgConnection: {} }));

const keypair = PgWeb3.Keypair.generate();
const walletKey = keypair.publicKey.toBase58();

/**
 * A message as the Rust CLI compiles it, which `from` pays for: its two
 * writable non-signers in descending order, which web3.js's own compile
 * would sort the other way, so a re-compile would change the bytes.
 */
const messageFrom = (from: PgWeb3.PublicKey) => {
  const [low, high] = [
    PgWeb3.Keypair.generate().publicKey,
    PgWeb3.Keypair.generate().publicKey,
  ].sort((a, b) => a.toBase58().localeCompare(b.toBase58()));
  return new PgWeb3.Message({
    header: {
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: 1,
    },
    accountKeys: [from, high, low, PgWeb3.SystemProgram.programId],
    recentBlockhash: PgWeb3.Keypair.generate().publicKey.toBase58(),
    instructions: [{ programIdIndex: 3, accounts: [0, 1, 2], data: "" }],
  }).serialize();
};

/** Whether `signature` is the wallet's over exactly `message`'s bytes */
const isWalletSignatureOver =
  (message: Uint8Array) => (signature: Uint8Array) =>
    ed25519.verify(signature, message, keypair.publicKey.toBytes());

/** Make `wallet` the current one, as `derivable` would */
const connect = (wallet: Wallet) =>
  Object.defineProperty(PgWallet, "current", {
    get: () => wallet,
    configurable: true,
  });

/** A built-in wallet for the key whose `signTransaction` is `sign` */
const walletSigningWith = (
  sign: (tx: PgWeb3.Transaction) => Promise<PgWeb3.Transaction>
) =>
  ({
    isPg: true,
    name: "Wallet 1",
    publicKey: keypair.publicKey,
    signTransaction: <T extends AnyTransaction>(tx: T) =>
      sign(tx as PgWeb3.Transaction),
  } as unknown as Wallet);

afterEach(() => {
  Reflect.deleteProperty(PgWallet, "current");
  vi.restoreAllMocks();
});

describe("utils/wallet/wallet signing for the WASM CLIs", () => {
  it("exposes the methods the WASM side looks up by name", () => {
    for (const name of [
      "signTransactionMessage",
      "getPublicKeyBytes",
      "hasKeysInPage",
    ]) {
      expect(typeof Reflect.get(PgWallet, name)).toBe("function");
    }
  });

  it("signTransactionMessage signs the CLI's exact message bytes", async () => {
    const provider = localSignerProviderWith((publicKey) =>
      publicKey.equals(keypair.publicKey)
        ? Array.from(keypair.secretKey)
        : undefined
    );
    const secretKeyFor = vi.spyOn(provider, "secretKeyFor");
    PgWallet.setSignerProvider(provider);
    connect(PgWallet.create({ name: "Wallet 1", publicKey: walletKey }));
    const message = messageFrom(keypair.publicKey);

    const signature = await PgWallet.signTransactionMessage(message, walletKey);

    expect(signature).toHaveLength(64);
    expect(await isWalletSignatureOver(message)(signature)).toBe(true);
    expect(secretKeyFor).not.toHaveBeenCalled();
  });

  it("signTransactionMessage asks the wallet's signTransaction once", async () => {
    const sign = vi.fn(async (tx: PgWeb3.Transaction) => {
      tx.partialSign(keypair);
      return tx;
    });
    connect(walletSigningWith(sign));
    const message = messageFrom(keypair.publicKey);

    const signature = await PgWallet.signTransactionMessage(message, walletKey);

    expect(sign).toHaveBeenCalledTimes(1);
    expect(await isWalletSignatureOver(message)(signature)).toBe(true);
  });

  it("signTransactionMessage refuses when no wallet is connected", async () => {
    await expect(
      PgWallet.signTransactionMessage(messageFrom(keypair.publicKey), walletKey)
    ).rejects.toThrow("Not connected");
  });

  it("signTransactionMessage refuses once another wallet is current", async () => {
    const sign = vi.fn();
    connect(walletSigningWith(sign));
    const other = PgWeb3.Keypair.generate().publicKey.toBase58();

    await expect(
      PgWallet.signTransactionMessage(messageFrom(keypair.publicKey), other)
    ).rejects.toThrow(`The wallet this command started with (${other})`);
    expect(sign).not.toHaveBeenCalled();
  });

  it("signTransactionMessage refuses a transaction the wallet left unsigned", async () => {
    connect(walletSigningWith(async (tx) => tx));

    await expect(
      PgWallet.signTransactionMessage(messageFrom(keypair.publicKey), walletKey)
    ).rejects.toThrow(`The wallet ${walletKey} did not sign the transaction`);
  });

  it("signTransactionMessage refuses a signature over other bytes", async () => {
    connect(
      walletSigningWith(async (tx) => {
        tx.addSignature(
          keypair.publicKey,
          Buffer.from(
            await ed25519.sign(
              messageFrom(keypair.publicKey),
              keypair.secretKey.slice(0, 32)
            )
          )
        );
        return tx;
      })
    );

    await expect(
      PgWallet.signTransactionMessage(messageFrom(keypair.publicKey), walletKey)
    ).rejects.toThrow("does not match the transaction it was asked to sign");
  });
});
