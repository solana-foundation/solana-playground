// @vitest-environment node -- noble checks `instanceof Uint8Array`, which jsdom's realm fails

import { utils } from "@coral-xyz/anchor";
import * as ed25519 from "@noble/ed25519";
import { afterEach, describe, expect, it } from "vitest";

import { serveSandboxWith } from "../js-runtime/page-channel";
import type { ToSandbox } from "../js-runtime/protocol";
import { channelFor } from "../js-runtime/sandbox/channel";
import { PgWeb3 } from "../web3";
import { sandboxSignerProviderWith } from "./sandbox-signer-provider";
import { signRequestWith } from "./sign-bridge";
import { localSignerProviderWith } from "./signer-provider";

/**
 * The sandbox's signer provider against the page's sign handler, over a real
 * `MessageChannel`, as `run` wires them (`js-runtime.ts`,
 * `sandbox/index.ts`).
 */

const keypair = PgWeb3.Keypair.generate();
const stranger = PgWeb3.Keypair.generate();
const account = { name: "Wallet 1", publicKey: keypair.publicKey };
const blockhash = PgWeb3.Keypair.generate().publicKey.toBase58();

/** The page's wallet, on its local provider */
const pageWallet = localSignerProviderWith((publicKey) =>
  publicKey.equals(keypair.publicKey)
    ? Array.from(keypair.secretKey)
    : undefined
).walletFor(account);

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** The sandbox's provider, and every message the page sent it */
const connect = () => {
  const channel = new MessageChannel();
  channels.push(channel);
  const toSandbox: ToSandbox[] = [];
  const pagePort = channel.port2;
  const post = pagePort.postMessage.bind(pagePort);
  pagePort.postMessage = (message: ToSandbox) => {
    toSandbox.push(message);
    post(message);
  };
  void serveSandboxWith({
    print: () => undefined,
    sign: signRequestWith(() => [pageWallet]),
    rpc: async () => ({ error: "no RPC in this test" }),
  })(pagePort);

  const sandbox = channelFor(channel.port1);
  return { provider: sandboxSignerProviderWith(sandbox.sign), toSandbox };
};

const transfer = () =>
  PgWeb3.SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: stranger.publicKey,
    lamports: 1,
  });
const legacyTx = () =>
  new PgWeb3.Transaction({
    feePayer: keypair.publicKey,
    recentBlockhash: blockhash,
  }).add(transfer());
const v0Tx = () =>
  new PgWeb3.VersionedTransaction(
    new PgWeb3.TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [transfer()],
    }).compileToV0Message()
  );

/** Whether `haystack` holds `needle` as a run of bytes */
const containsBytes = (haystack: Uint8Array, needle: Uint8Array) => {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((byte, j) => haystack[i + j] === byte)) return true;
  }
  return false;
};

/** Every form the private key could take in a message */
const keyForms = (privateKey: Uint8Array) => {
  const buffer = Buffer.from(privateKey);
  return [
    buffer.toString("hex"),
    buffer.toString("base64"),
    utils.bytes.bs58.encode(buffer),
    JSON.stringify(Array.from(privateKey)).slice(1, -1),
  ];
};

describe("sandbox signing", () => {
  it("wallet-signing: pg.wallet signs from the sandbox", async () => {
    const { provider } = connect();
    const wallet = provider.walletFor(account);

    const legacy = await wallet.signTransaction(legacyTx());
    expect(legacy.verifySignatures()).toBe(true);

    const [first, second] = await wallet.signAllTransactions([
      legacyTx(),
      legacyTx(),
    ]);
    expect(first.verifySignatures() && second.verifySignatures()).toBe(true);

    const v0 = await wallet.signTransaction(v0Tx());
    expect(
      await ed25519.verify(
        v0.signatures[0],
        v0.message.serialize(),
        keypair.publicKey.toBytes()
      )
    ).toBe(true);

    const message = new TextEncoder().encode("hello");
    const signature = await wallet.signMessage(message);
    expect(
      await ed25519.verify(signature, message, keypair.publicKey.toBytes())
    ).toBe(true);
  });

  it("wallet-signing: A sign request for an account the page does not hold", async () => {
    const { provider } = connect();
    const wallet = provider.walletFor({
      name: "Other",
      publicKey: stranger.publicKey,
    });

    await expect(
      wallet.signMessage(new TextEncoder().encode("hello"))
    ).rejects.toThrow(`No key for account ${stranger.publicKey.toBase58()}`);
  });

  it("wallet-signing: No message to the sandbox carries the key", async () => {
    const { provider, toSandbox } = connect();
    const wallet = provider.walletFor(account);

    await wallet.signTransaction(legacyTx());
    await wallet.signTransaction(v0Tx());
    await wallet.signMessage(new TextEncoder().encode("hello"));

    expect(toSandbox).toHaveLength(3);
    const privateKey = keypair.secretKey.slice(0, 32);
    for (const message of toSandbox) {
      const text = JSON.stringify(message, (_key, value) =>
        value instanceof Uint8Array ? Array.from(value) : value
      );
      for (const form of keyForms(privateKey)) {
        expect(text).not.toContain(form);
      }
      if (message.type === "sign" && "signature" in message.reply) {
        expect(containsBytes(message.reply.signature, privateKey)).toBe(false);
      }
    }
  });

  it("refuses to hand the sandbox key bytes", () => {
    const { provider } = connect();
    expect(() => provider.secretKeyFor(keypair.publicKey)).toThrow(
      "pg.wallet.signTransaction"
    );
    const sandboxKeypair = provider.walletFor(account).keypair;
    expect(sandboxKeypair).toBeInstanceOf(PgWeb3.Keypair);
    expect(sandboxKeypair.publicKey.equals(keypair.publicKey)).toBe(true);
    expect(() => sandboxKeypair.secretKey).toThrow("pg.wallet.signMessage");
  });
});
