// @vitest-environment node -- noble checks `instanceof Uint8Array`, which jsdom's realm fails

import * as ed25519 from "@noble/ed25519";
import * as web3 from "@solana/web3.js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  sandboxKeypairWith,
  type SignThroughPage,
} from "../../wallet/sandbox-signer-provider";
import { patchConfirmTransaction } from "./confirm";
import {
  countUnsent,
  patchWeb3,
  spliceRpcBody,
  spliceSignatures,
} from "./placeholders";

/**
 * The sandbox's web3.js patch with a sandbox keypair whose "page" signs with
 * the real key a moment later, as the page does over the port.
 */

const wallet = web3.Keypair.generate();
const other = web3.Keypair.generate();
const blockhash = web3.Keypair.generate().publicKey.toBase58();

/** The page: signs as `wallet` after a tick, refuses anyone else */
const pageSign: SignThroughPage = (publicKey) => () => async (bytes) => {
  await new Promise((resolve) => setTimeout(resolve, 1));
  if (!publicKey.equals(wallet.publicKey)) {
    throw new Error(`No key for account ${publicKey.toBase58()}`);
  }
  return ed25519.sign(bytes, wallet.secretKey.slice(0, 32));
};

const sandboxKeypair = () => sandboxKeypairWith(pageSign)(wallet.publicKey);

const transferFrom = (from: web3.PublicKey) =>
  web3.SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: other.publicKey,
    lamports: 1,
  });
const legacyTx = () =>
  new web3.Transaction({
    feePayer: wallet.publicKey,
    recentBlockhash: blockhash,
  }).add(transferFrom(wallet.publicKey));
const v0TxWith = (instructions: web3.TransactionInstruction[]) =>
  new web3.VersionedTransaction(
    new web3.TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message()
  );

/** Whether every signature of a wire transaction verifies */
const isWireSigned = (wire: Uint8Array) => {
  const tx = web3.VersionedTransaction.deserialize(wire);
  const keys = tx.message.staticAccountKeys;
  return Promise.all(
    tx.signatures.map((signature, i) =>
      // A placeholder is not even a curve point, and noble throws on it
      ed25519
        .verify(signature, tx.message.serialize(), keys[i].toBytes())
        .catch(() => false)
    )
  ).then((all) => all.every(Boolean));
};

describe("sandbox web3.js patch", () => {
  beforeAll(() => {
    patchWeb3(web3);
  });

  it("Transaction.sign returns a promise after which the signature is real", async () => {
    const tx = legacyTx();
    const signed = tx.sign(sandboxKeypair()) as unknown as Promise<void>;
    expect(signed).toBeInstanceOf(Promise);
    expect(tx.verifySignatures()).toBe(false);

    await signed;

    expect(tx.verifySignatures()).toBe(true);
  });

  it("serialize right after a synchronous sign holds a placeholder the send splices", async () => {
    const tx = legacyTx();
    void tx.sign(sandboxKeypair());

    const wire = tx.serialize();
    expect(await isWireSigned(wire)).toBe(false);
    expect(await isWireSigned(await spliceSignatures(wire))).toBe(true);
  });

  it("spliceRpcBody puts the real signature into sendTransaction and simulateTransaction", async () => {
    for (const method of ["sendTransaction", "simulateTransaction"]) {
      const tx = legacyTx();
      void tx.sign(sandboxKeypair());
      const encoded = tx.serialize().toString("base64");

      const body = await spliceRpcBody({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: [encoded, { encoding: "base64" }],
      });

      expect(
        await isWireSigned(Buffer.from(body.params[0] as string, "base64"))
      ).toBe(true);
      expect(body.params[1]).toEqual({ encoding: "base64" });
    }
  });

  it("spliceRpcBody leaves every other method alone", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: ["x"],
    };
    expect(await spliceRpcBody(body)).toBe(body);
  });

  it("partialSign signs with another keypair alongside the wallet", async () => {
    const newAccount = web3.Keypair.generate();
    const tx = new web3.Transaction({
      feePayer: wallet.publicKey,
      recentBlockhash: blockhash,
    }).add(
      web3.SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: newAccount.publicKey,
        lamports: 1,
        space: 0,
        programId: web3.SystemProgram.programId,
      })
    );

    await (tx.sign(sandboxKeypair(), newAccount) as unknown as Promise<void>);

    expect(tx.verifySignatures()).toBe(true);
    expect(tx.signatures).toHaveLength(2);
  });

  describe("signers mixed in one transaction", () => {
    const second = web3.Keypair.generate();
    /** The page: holds both `wallet` and `second` */
    const pageOfTwo: SignThroughPage = (publicKey) => () => async (bytes) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const held = [wallet, second].find((keypair) =>
        keypair.publicKey.equals(publicKey)
      );
      if (!held) throw new Error(`No key for account ${publicKey.toBase58()}`);
      return ed25519.sign(bytes, held.secretKey.slice(0, 32));
    };
    const sandboxed = (keypair: web3.Keypair) =>
      sandboxKeypairWith(pageOfTwo)(keypair.publicKey);

    /** Pays from `wallet` and makes `account` sign too: a fresh message */
    const instructionsWith = (account: web3.PublicKey) => [
      transferFrom(wallet.publicKey),
      web3.SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: other.publicKey,
        lamports: 1,
      }),
    ];
    const legacyWith = (account: web3.PublicKey) =>
      new web3.Transaction({
        feePayer: wallet.publicKey,
        recentBlockhash: web3.Keypair.generate().publicKey.toBase58(),
      }).add(...instructionsWith(account));
    const v0With = (account: web3.PublicKey) =>
      new web3.VersionedTransaction(
        new web3.TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: web3.Keypair.generate().publicKey.toBase58(),
          instructions: instructionsWith(account),
        }).compileToV0Message()
      );

    it("legacy: a real signer, then the sandbox keypair, keeps both", async () => {
      const real = web3.Keypair.generate();
      const tx = legacyWith(real.publicKey);
      void tx.partialSign(real);
      await (tx.partialSign(sandboxed(wallet)) as unknown as Promise<void>);
      expect(tx.signatures.every((pair) => pair.signature)).toBe(true);
      expect(tx.verifySignatures()).toBe(true);
    });

    it("legacy: the sandbox keypair, then a real signer, keeps both", async () => {
      const real = web3.Keypair.generate();
      const tx = legacyWith(real.publicKey);
      const signed = tx.partialSign(
        sandboxed(wallet)
      ) as unknown as Promise<void>;
      void tx.partialSign(real);
      await signed;
      expect(tx.verifySignatures()).toBe(true);
    });

    it("legacy: two sandbox keypairs in one sign", async () => {
      const tx = legacyWith(second.publicKey);
      await (tx.sign(
        sandboxed(second),
        sandboxed(wallet)
      ) as unknown as Promise<void>);
      expect(tx.signatures).toHaveLength(2);
      expect(tx.verifySignatures()).toBe(true);
    });

    it("v0: a real signer and the sandbox keypair, in either order", async () => {
      for (const order of ["real first", "sandbox first"]) {
        const real = web3.Keypair.generate();
        const tx = v0With(real.publicKey);
        const signers =
          order === "real first"
            ? [real, sandboxed(wallet)]
            : [sandboxed(wallet), real];
        await (tx.sign(signers) as unknown as Promise<void>);
        expect(await isWireSigned(tx.serialize())).toBe(true);
      }
    });

    it("v0: two sandbox keypairs, spliced before they land and signed after", async () => {
      const tx = v0With(second.publicKey);
      const signed = tx.sign([
        sandboxed(wallet),
        sandboxed(second),
      ]) as unknown as Promise<void>;

      const wire = tx.serialize();
      expect(await isWireSigned(await spliceSignatures(wire))).toBe(true);

      await signed;
      expect(await isWireSigned(tx.serialize())).toBe(true);
    });
  });

  it("VersionedTransaction.sign signs a v0 transaction with the wallet", async () => {
    const tx = v0TxWith([transferFrom(wallet.publicKey)]);
    const signed = tx.sign([sandboxKeypair()]) as unknown as Promise<void>;

    const wire = tx.serialize();
    expect(await isWireSigned(await spliceSignatures(wire))).toBe(true);

    await signed;
    expect(await isWireSigned(tx.serialize())).toBe(true);
  });

  it("VersionedTransaction.sign refuses a keypair that is not a signer", () => {
    const tx = v0TxWith([transferFrom(wallet.publicKey)]);
    const stranger = sandboxKeypairWith(pageSign)(other.publicKey);
    expect(() => tx.sign([stranger])).toThrow(
      "Cannot sign with non signer key"
    );
  });

  it("serialize still fails on an invalid signature that is no placeholder", async () => {
    const tx = legacyTx();
    await (tx.sign(sandboxKeypair()) as unknown as Promise<void>);
    tx.signatures[0].signature = Buffer.alloc(64, 1);
    expect(() => tx.serialize()).toThrow("Signature verification failed");
  });

  it("a refused sign rejects the awaited sign and the send", async () => {
    const refused = sandboxKeypairWith(pageSign)(other.publicKey);
    const tx = new web3.Transaction({
      feePayer: other.publicKey,
      recentBlockhash: blockhash,
    }).add(transferFrom(other.publicKey));

    const signed = tx.sign(refused) as unknown as Promise<void>;
    const wire = tx.serialize();

    await expect(signed).rejects.toThrow("No key for account");
    await expect(spliceSignatures(wire)).rejects.toThrow("No key for account");
  });

  it("signing the same message twice gives the same placeholder, and one request to the page", async () => {
    let asked = 0;
    const counting = sandboxKeypairWith((publicKey) => (kind) => (bytes) => {
      asked += 1;
      return pageSign(publicKey)(kind)(bytes);
    })(wallet.publicKey);
    const recent = web3.Keypair.generate().publicKey.toBase58();
    const txWith = () =>
      new web3.Transaction({
        feePayer: wallet.publicKey,
        recentBlockhash: recent,
      }).add(transferFrom(wallet.publicKey));

    const first = txWith();
    const second = txWith();
    const signedFirst = first.sign(counting) as unknown as Promise<void>;
    const signedSecond = second.sign(counting) as unknown as Promise<void>;
    expect(first.signature).toEqual(second.signature);

    await Promise.all([signedFirst, signedSecond]);
    expect(asked).toBe(1);
    expect(first.verifySignatures() && second.verifySignatures()).toBe(true);
  });

  it("a second send of the same transfer gets a fresh blockhash from web3.js's duplicate check", async () => {
    const connection = new web3.Connection("http://localhost:1", "confirmed");
    const cached = web3.Keypair.generate().publicKey.toBase58();
    const fresh = web3.Keypair.generate().publicKey.toBase58();
    const blockhashes = vi
      .spyOn(
        connection as unknown as {
          _blockhashWithExpiryBlockHeight: (
            disableCache: boolean
          ) => Promise<web3.BlockhashWithExpiryBlockHeight>;
        },
        "_blockhashWithExpiryBlockHeight"
      )
      .mockImplementation(async (disableCache) => ({
        blockhash: disableCache ? fresh : cached,
        lastValidBlockHeight: 100,
      }));
    const sent: string[] = [];
    vi.spyOn(connection, "sendEncodedTransaction").mockImplementation(
      async (encoded) => {
        sent.push(encoded);
        return "signature";
      }
    );
    const transfer = () =>
      new web3.Transaction({ feePayer: wallet.publicKey }).add(
        transferFrom(wallet.publicKey)
      );

    await connection.sendTransaction(transfer(), [sandboxKeypair()]);
    await connection.sendTransaction(transfer(), [sandboxKeypair()]);

    expect(blockhashes).toHaveBeenLastCalledWith(true);
    expect(
      sent.map(
        (encoded) =>
          web3.VersionedTransaction.deserialize(Buffer.from(encoded, "base64"))
            .message.recentBlockhash
      )
    ).toEqual([cached, fresh]);
  });

  it("countUnsent counts placeholders serialized and never sent", async () => {
    const before = countUnsent();
    // A message no other test signed: a repeat shares its placeholder
    const tx = new web3.Transaction({
      feePayer: wallet.publicKey,
      recentBlockhash: web3.Keypair.generate().publicKey.toBase58(),
    }).add(transferFrom(wallet.publicKey));
    void tx.sign(sandboxKeypair());
    tx.serialize();
    expect(countUnsent()).toBe(before + 1);
  });
});

describe("sandbox confirmTransaction", () => {
  beforeAll(() => {
    patchConfirmTransaction(web3);
  });

  it("polls the signature status until it reaches the commitment", async () => {
    const connection = new web3.Connection("http://localhost:1", "confirmed");
    const statuses = vi
      .spyOn(connection, "getSignatureStatuses")
      // eslint-disable-next-line unicorn/no-null -- the RPC's answer for an unknown signature
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [null] })
      .mockResolvedValue({
        context: { slot: 2 },
        value: [
          {
            slot: 2,
            confirmations: 1,
            // eslint-disable-next-line unicorn/no-null -- the RPC's answer for a success
            err: null,
            confirmationStatus: "confirmed",
          },
        ],
      });
    vi.spyOn(connection, "getBlockHeight").mockResolvedValue(10);

    const result = await connection.confirmTransaction({
      signature: "sig",
      blockhash,
      lastValidBlockHeight: 100,
    });

    expect(result.value.err).toBeNull();
    expect(statuses).toHaveBeenCalledTimes(2);
  });

  it("throws once the blockhash expires", async () => {
    const connection = new web3.Connection("http://localhost:1", "confirmed");
    vi.spyOn(connection, "getSignatureStatuses").mockResolvedValue({
      context: { slot: 1 },
      // eslint-disable-next-line unicorn/no-null -- the RPC's answer for an unknown signature
      value: [null],
    });
    vi.spyOn(connection, "getBlockHeight").mockResolvedValue(101);

    await expect(
      connection.confirmTransaction({
        signature: "sig",
        blockhash,
        lastValidBlockHeight: 100,
      })
    ).rejects.toThrow(web3.TransactionExpiredBlockheightExceededError);
  });
});
