// @vitest-environment node -- noble and web3 check `instanceof Uint8Array`, which jsdom's realm fails

import * as ed25519 from "@noble/ed25519";

import type { DistributiveOmit, KeyReply, KeyRequest } from "../protocol";
import type { KeyStore } from "./store";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * @param bytes bytes to encode
 * @returns the bytes in base58, as Solana writes public keys
 */
export const base58Encode = (bytes: Uint8Array) => {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let text = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    text += ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) text += ALPHABET[digits[i]];
  return text;
};

const PUBLIC_KEY_LENGTH = 32;
const SECRET_KEY_LENGTH = 64;
const SIGNATURE_LENGTH = 64;
const VERSIONED_FLAG = 0x80;

/** A refusal whose message is safe to send: it never holds key bytes */
class Refusal extends Error {}

/**
 * Whether bytes read as a serialized transaction message, legacy or v0. A
 * transaction message is signed as a transaction; signing it as a "message"
 * would let a page get a transaction signed without the transaction flow.
 *
 * @param bytes the bytes to inspect
 * @returns whether the bytes are exactly one serialized message
 */
export const looksLikeTransactionMessage = (bytes: Uint8Array) => {
  let at = 0;
  const byteAt = () => (at < bytes.length ? bytes[at++] : undefined);
  const skip = (count: number) => {
    at += count;
    return at <= bytes.length;
  };
  /** A compact-u16 length, or `undefined` when it is cut or too long */
  const length = () => {
    let value = 0;
    for (let shift = 0; shift < 21; shift += 7) {
      const byte = byteAt();
      if (byte === undefined) return undefined;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
    }
    return undefined;
  };
  /** Skips a compact-u16 length and that many `size`-byte items */
  const skipList = (size: number) => {
    const count = length();
    return count !== undefined && skip(count * size);
  };

  const first = byteAt();
  if (first === undefined) return false;
  let isVersioned = false;
  if (first & VERSIONED_FLAG) {
    // Only version 0 exists
    if (first !== VERSIONED_FLAG) return false;
    isVersioned = true;
  } else {
    at = 0;
  }
  // Header: required signatures, read-only signed, read-only unsigned
  const required = byteAt();
  if (required === undefined || !skip(2) || required === 0) return false;
  const accounts = length();
  if (accounts === undefined || accounts < required) return false;
  if (!skip(accounts * PUBLIC_KEY_LENGTH) || !skip(PUBLIC_KEY_LENGTH)) {
    return false;
  }
  const instructions = length();
  if (instructions === undefined) return false;
  for (let i = 0; i < instructions; i++) {
    const program = byteAt();
    if (program === undefined || program >= accounts) return false;
    if (!skipList(1) || !skipList(1)) return false;
  }
  if (isVersioned) {
    const lookups = length();
    if (lookups === undefined) return false;
    for (let i = 0; i < lookups; i++) {
      if (!skip(PUBLIC_KEY_LENGTH) || !skipList(1) || !skipList(1)) {
        return false;
      }
    }
  }
  return at === bytes.length;
};

const unknownAccount = (publicKey: string) =>
  new Refusal(`No key for account ${publicKey}`);

const publicKeyOfSecret = async (secret: Uint8Array) =>
  ed25519.getPublicKey(secret.slice(0, PUBLIC_KEY_LENGTH));

/**
 * The key page's request handler: every key it makes or adopts goes straight
 * into the store, and no reply carries key bytes. A key made and never added
 * is dropped by the app with `forget`.
 *
 * @param store where the keys are stored
 * @returns a function that answers one request
 */
export const handlerWith = (store: KeyStore) => {
  const secretFor = async (publicKey: string) => {
    const secret = (await store.all()).get(publicKey);
    if (!secret) throw unknownAccount(publicKey);
    return secret;
  };

  const publicKeysStored = async () => [...(await store.all()).keys()];

  const answer = async (
    request: KeyRequest
  ): Promise<DistributiveOmit<KeyReply, "id">> => {
    switch (request.type) {
      case "accounts":
        return { ok: true, result: await publicKeysStored() };
      case "create": {
        const priv = ed25519.utils.randomPrivateKey();
        const pub = await ed25519.getPublicKey(priv);
        const secret = new Uint8Array(SECRET_KEY_LENGTH);
        secret.set(priv);
        secret.set(pub, PUBLIC_KEY_LENGTH);
        const publicKey = base58Encode(pub);
        await store.put([[publicKey, secret]]);
        return { ok: true, result: publicKey };
      }
      case "sign": {
        const secret = await secretFor(request.publicKey);
        if (
          request.kind === "message" &&
          looksLikeTransactionMessage(request.bytes)
        ) {
          throw new Refusal("This message is a transaction");
        }
        const signature = await ed25519.sign(
          request.bytes,
          secret.slice(0, PUBLIC_KEY_LENGTH)
        );
        if (signature.length !== SIGNATURE_LENGTH) {
          throw new Refusal("The signature has the wrong length");
        }
        return { ok: true, result: signature };
      }
      case "forget":
        await store.remove(request.publicKey);
        // eslint-disable-next-line unicorn/no-null -- the wire's "nothing"
        return { ok: true, result: null };
      case "adopt": {
        const entries: [string, Uint8Array][] = [];
        for (const [index, key] of request.keys.entries()) {
          const secret = Uint8Array.from(key);
          const pub = await publicKeyOfSecret(secret);
          const isMatch = pub.every(
            (byte, i) => byte === secret[PUBLIC_KEY_LENGTH + i]
          );
          if (!isMatch) {
            throw new Refusal(`Key ${index + 1} does not match its public key`);
          }
          entries.push([base58Encode(pub), secret]);
        }
        // All or nothing: nothing is written before every key checked out
        await store.put(entries);
        const present = await publicKeysStored();
        const missing = entries.some(
          ([publicKey]) => !present.includes(publicKey)
        );
        if (missing) throw new Refusal("The keys were not stored");
        return { ok: true, result: present };
      }
    }
  };

  return async (request: KeyRequest): Promise<KeyReply> => {
    try {
      return { id: request.id, ...(await answer(request)) };
    } catch (error) {
      // Our own refusals are written to be sent; anything else is named by
      // its type only, since a library's message is not ours to vouch for
      const text =
        error instanceof Refusal
          ? error.message
          : `The key page failed: ${
              error instanceof Error ? error.name : typeof error
            }`;
      return { id: request.id, ok: false, error: text };
    }
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/wallet/key-origin/frame/handler", () => {
    type Web3 = typeof import("../../../web3");
    const memoryStore = () => {
      const kept = new Map<string, Uint8Array>();
      const store: KeyStore = {
        all: async () => new Map(kept),
        put: async (entries) => {
          for (const [k, v] of entries) kept.set(k, v);
        },
        remove: async (k) => {
          kept.delete(k);
        },
      };
      return { kept, store };
    };

    let id = 0;
    const ask = (
      handle: ReturnType<typeof handlerWith>,
      request: DistributiveOmit<KeyRequest, "id">
    ) => handle(Object.assign({ id: ++id }, request) as KeyRequest);

    const created = async (handle: ReturnType<typeof handlerWith>) => {
      const reply = await ask(handle, { type: "create" });
      if (!reply.ok || typeof reply.result !== "string") throw new Error("x");
      return reply.result;
    };

    const secretKey = async (seed: number) => {
      const priv = Uint8Array.from({ length: 32 }, (_, i) => i + seed);
      const secret = new Uint8Array(64);
      secret.set(priv);
      secret.set(await ed25519.getPublicKey(priv), 32);
      return secret;
    };

    it("encodes base58 like web3", async () => {
      const { PgWeb3 } = (await import("../../../web3")) as Web3;
      for (const bytes of [
        Uint8Array.from({ length: 32 }, (_, i) => i * 7),
        new Uint8Array(32),
        Uint8Array.from({ length: 32 }, (_, i) => (i < 3 ? 0 : 255)),
      ]) {
        expect(base58Encode(bytes)).toBe(
          new PgWeb3.PublicKey(bytes).toBase58()
        );
      }
    });

    it("creates a key and signs", async () => {
      const { store } = memoryStore();
      const handle = handlerWith(store);
      const publicKey = await created(handle);
      const bytes = Uint8Array.from([1, 2, 3]);

      const reply = await ask(handle, {
        type: "sign",
        publicKey,
        kind: "transaction",
        bytes,
      });

      if (!reply.ok || !(reply.result instanceof Uint8Array)) {
        throw new Error("expected a signature");
      }
      expect(reply.result).toHaveLength(64);
      const { PgWeb3 } = (await import("../../../web3")) as Web3;
      expect(
        await ed25519.verify(
          reply.result,
          bytes,
          new PgWeb3.PublicKey(publicKey).toBytes()
        )
      ).toBe(true);
    });

    // The panel that offers the new key's file is another key page instance,
    // which sees only the store
    it("stores a key it creates at once", async () => {
      const { store, kept } = memoryStore();
      const handle = handlerWith(store);
      const publicKey = await created(handle);

      expect(Array.from(kept.keys())).toEqual([publicKey]);
      expect(await ask(handlerWith(store), { type: "accounts" })).toMatchObject(
        { result: [publicKey] }
      );
    });

    it("forgets a key", async () => {
      const { store } = memoryStore();
      const handle = handlerWith(store);
      const publicKey = await created(handle);

      await ask(handle, { type: "forget", publicKey });

      expect(await ask(handle, { type: "accounts" })).toMatchObject({
        result: [],
      });
      const reply = await ask(handle, {
        type: "sign",
        publicKey,
        kind: "transaction",
        bytes: new Uint8Array(1),
      });
      expect(reply).toMatchObject({
        ok: false,
        error: `No key for account ${publicKey}`,
      });
    });

    it("adopts keys, idempotently", async () => {
      const { store } = memoryStore();
      const handle = handlerWith(store);
      const keys = await Promise.all([1, 2, 3].map(secretKey));
      const request = {
        type: "adopt",
        keys: keys.map((k) => Array.from(k)),
      } as const;

      const first = await ask(handle, request);
      const second = await ask(handle, request);

      if (!first.ok || !second.ok) throw new Error("expected success");
      expect(first.result).toHaveLength(3);
      expect(second.result).toEqual(first.result);
    });

    it("stores nothing when one adopted key does not match its public half", async () => {
      const { store, kept } = memoryStore();
      const handle = handlerWith(store);
      const good = await secretKey(1);
      const bad = await secretKey(2);
      bad.set(good.slice(32), 32);

      const reply = await ask(handle, {
        type: "adopt",
        keys: [Array.from(good), Array.from(bad)],
      });

      expect(reply.ok).toBe(false);
      expect(kept.size).toBe(0);
    });

    it("refuses to sign a transaction message as a message", async () => {
      const { PgWeb3 } = (await import("../../../web3")) as Web3;
      const { store } = memoryStore();
      const handle = handlerWith(store);
      const publicKey = await created(handle);
      const payer = new PgWeb3.PublicKey(publicKey);
      const instruction = PgWeb3.SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: payer,
        lamports: 1,
      });
      const blockhash = base58Encode(new Uint8Array(32).fill(7));
      const legacy = new PgWeb3.TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: [instruction],
      });

      for (const message of [
        legacy.compileToLegacyMessage().serialize(),
        legacy.compileToV0Message().serialize(),
      ]) {
        const bytes = Uint8Array.from(message);
        expect(looksLikeTransactionMessage(bytes)).toBe(true);
        expect(
          await ask(handle, { type: "sign", publicKey, kind: "message", bytes })
        ).toMatchObject({ ok: false, error: "This message is a transaction" });
        expect(
          (
            await ask(handle, {
              type: "sign",
              publicKey,
              kind: "transaction",
              bytes,
            })
          ).ok
        ).toBe(true);
      }
    });

    it("does not take ordinary text for a transaction message", () => {
      expect(
        looksLikeTransactionMessage(new TextEncoder().encode("Sign in to x"))
      ).toBe(false);
      expect(looksLikeTransactionMessage(new Uint8Array(0))).toBe(false);
      expect(
        looksLikeTransactionMessage(Uint8Array.from([0x81, 1, 0, 0]))
      ).toBe(false);
    });

    it("never puts key bytes in a reply", async () => {
      const { store, kept } = memoryStore();
      const handle = handlerWith(store);
      const keys = await Promise.all([1, 2].map(secretKey));
      const replies = [
        await ask(handle, { type: "create" }),
        await ask(handle, {
          type: "adopt",
          keys: keys.map((k) => Array.from(k)),
        }),
        await ask(handle, { type: "accounts" }),
        await ask(handle, { type: "forget", publicKey: "nothing" }),
        await ask(handle, {
          type: "sign",
          publicKey: "nothing",
          kind: "message",
          bytes: new Uint8Array(1),
        }),
        await ask(handle, {
          type: "adopt",
          keys: [Array.from({ length: 64 }, () => 9)],
        }),
      ];
      const text = JSON.stringify(replies, (_, v) =>
        v instanceof Uint8Array ? Array.from(v) : v
      );

      for (const secret of kept.values()) {
        expect(text).not.toContain(Array.from(secret.slice(0, 8)).join(","));
      }
      expect(text).not.toContain(Array.from(keys[0].slice(0, 8)).join(","));
    });
  });
}
