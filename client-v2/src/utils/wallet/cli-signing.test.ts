// @vitest-environment node -- noble checks `instanceof Uint8Array`, which jsdom's realm fails
//
// The WASM CLIs sign the built-in wallet's slot through `PgWallet` at the
// send step, never with its key bytes (`wasm/utils/solana-playground-utils`,
// `wallet.rs`).
import { afterEach, describe, expect, it, vi } from "vitest";

import { PgWeb3 } from "../web3";
import { localSignerProviderWith } from "./signer-provider";
import type { AnyTransaction, Wallet } from "./types";
import { PgWallet } from "./wallet";

// The connection module reads build-time globals the unit runner does not
// define; signing never touches it.
vi.mock("../connection", () => ({ PgConnection: {} }));

const keypair = PgWeb3.Keypair.generate();

/** A CLI's serialized message, which `from` pays for */
const messageFrom = (from: PgWeb3.PublicKey) =>
  new PgWeb3.Transaction({
    feePayer: from,
    recentBlockhash: PgWeb3.Keypair.generate().publicKey.toBase58(),
  })
    .add(
      PgWeb3.SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: PgWeb3.Keypair.generate().publicKey,
        lamports: 1,
      })
    )
    .serializeMessage();

/** Whether `signature` is `signer`'s over `message` */
const isSignatureOver =
  (message: Uint8Array, signer: PgWeb3.PublicKey) =>
  (signature: Uint8Array) => {
    const tx = PgWeb3.Transaction.populate(PgWeb3.Message.from(message));
    tx.addSignature(signer, Buffer.from(signature));
    return tx.verifySignatures();
  };

/** Make `wallet` the current one, as `derivable` would */
const connect = (wallet: Wallet) =>
  Object.defineProperty(PgWallet, "current", {
    get: () => wallet,
    configurable: true,
  });

afterEach(() => {
  Reflect.deleteProperty(PgWallet, "current");
  vi.restoreAllMocks();
});

describe("utils/wallet/wallet signing for the WASM CLIs", () => {
  it("signTransactionMessage returns the wallet's signature over the message", async () => {
    const provider = localSignerProviderWith((publicKey) =>
      publicKey.equals(keypair.publicKey)
        ? Array.from(keypair.secretKey)
        : undefined
    );
    const secretKeyFor = vi.spyOn(provider, "secretKeyFor");
    PgWallet.setSignerProvider(provider);
    connect(
      PgWallet.create({
        name: "Wallet 1",
        publicKey: keypair.publicKey.toBase58(),
      })
    );
    const message = messageFrom(keypair.publicKey);

    const signature = await PgWallet.signTransactionMessage(message);

    expect(signature).toHaveLength(64);
    expect(isSignatureOver(message, keypair.publicKey)(signature)).toBe(true);
    expect(secretKeyFor).not.toHaveBeenCalled();
  });

  it("signTransactionMessage asks the wallet's signTransaction, which the key page answers", async () => {
    const signTransaction = vi.fn(async <T extends AnyTransaction>(tx: T) => {
      (tx as PgWeb3.Transaction).partialSign(keypair);
      return tx;
    });
    connect({
      isPg: true,
      name: "Wallet 1",
      publicKey: keypair.publicKey,
      signTransaction,
    } as unknown as Wallet);
    const message = messageFrom(keypair.publicKey);

    const signature = await PgWallet.signTransactionMessage(message);

    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(isSignatureOver(message, keypair.publicKey)(signature)).toBe(true);
  });

  it("signTransactionMessage refuses when no wallet is connected", async () => {
    await expect(
      PgWallet.signTransactionMessage(messageFrom(keypair.publicKey))
    ).rejects.toThrow("Not connected");
  });
});
