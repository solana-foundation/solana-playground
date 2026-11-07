/** Version of the protocol between the app page and the key page */
export const KEY_PROTOCOL_VERSION = 1;

/** `Omit` that keeps each member of a union apart */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** What the app page asks of the key page; `id` pairs a reply to its request */
export type KeyRequest = { id: number } & (
  | { type: "accounts" }
  | { type: "create" }
  | { type: "keep"; publicKey: string }
  | {
      type: "sign";
      publicKey: string;
      kind: "transaction" | "message";
      bytes: Uint8Array;
    }
  | { type: "forget"; publicKey: string }
  | { type: "adopt"; keys: number[][] }
);

/**
 * The key page's answer: `accounts` and `adopt` give public keys, `create` a
 * public key, `sign` the 64 signature bytes, `keep` and `forget` `null`.
 * Never key bytes.
 */
export type KeyReply = {
  id: number;
} & ( // eslint-disable-next-line unicorn/no-null -- `keep` and `forget` answer "nothing" on the wire
  | { ok: true; result: string[] | string | Uint8Array | null }
  | { ok: false; error: string }
);

/** The key page tells the app it is listening */
export type KeyReady = { type: "pg-wallet-keys:ready"; version: number };

/** The app answers the ready message, handing over the port */
export type KeyHandshake = { type: "pg-wallet-keys:connect"; version: number };

const SECRET_KEY_LENGTH = 64;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;

const isString = (x: unknown): x is string => typeof x === "string";

const isSecretKey = (x: unknown) =>
  Array.isArray(x) &&
  x.length === SECRET_KEY_LENGTH &&
  x.every((b) => Number.isInteger(b) && b >= 0 && b <= 255);

/**
 * @param x a message received from another window
 * @returns whether it is a well-formed key request
 */
export const isKeyRequest = (x: unknown): x is KeyRequest => {
  if (!isRecord(x) || typeof x.id !== "number") return false;
  switch (x.type) {
    case "accounts":
    case "create":
      return true;
    case "keep":
    case "forget":
      return isString(x.publicKey);
    case "sign":
      return (
        isString(x.publicKey) &&
        (x.kind === "transaction" || x.kind === "message") &&
        x.bytes instanceof Uint8Array
      );
    case "adopt":
      return Array.isArray(x.keys) && x.keys.every(isSecretKey);
    default:
      return false;
  }
};

/**
 * @param x a message received from another window
 * @returns whether it is a well-formed key reply
 */
export const isKeyReply = (x: unknown): x is KeyReply => {
  if (!isRecord(x) || typeof x.id !== "number") return false;
  if (x.ok === false) return isString(x.error);
  if (x.ok !== true) return false;
  const result = x.result;
  return (
    // eslint-disable-next-line unicorn/no-null -- the wire's "nothing"
    result === null ||
    isString(result) ||
    result instanceof Uint8Array ||
    (Array.isArray(result) && result.every(isString))
  );
};

/**
 * @param x a message received from another window
 * @returns whether it is the key page's ready message
 */
export const isKeyReady = (x: unknown): x is KeyReady =>
  isRecord(x) &&
  x.type === "pg-wallet-keys:ready" &&
  typeof x.version === "number";

/**
 * @param x a message received from another window
 * @returns whether it is the app's handshake
 */
export const isKeyHandshake = (x: unknown): x is KeyHandshake =>
  isRecord(x) &&
  x.type === "pg-wallet-keys:connect" &&
  typeof x.version === "number";

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/wallet/key-origin/protocol", () => {
    const key = Array.from({ length: 64 }, (_, i) => i);

    it("accepts each request shape", () => {
      const requests: unknown[] = [
        { id: 1, type: "accounts" },
        { id: 2, type: "create" },
        { id: 3, type: "keep", publicKey: "abc" },
        {
          id: 4,
          type: "sign",
          publicKey: "abc",
          kind: "transaction",
          bytes: new Uint8Array(3),
        },
        { id: 5, type: "forget", publicKey: "abc" },
        { id: 6, type: "adopt", keys: [key, key] },
      ];
      for (const request of requests) expect(isKeyRequest(request)).toBe(true);
    });

    it("rejects malformed requests", () => {
      const bad: unknown[] = [
        {},
        undefined,
        "accounts",
        { id: 1 },
        { id: 1, type: "nope" },
        { type: "accounts" },
        { id: 1, type: "keep" },
        {
          id: 1,
          type: "sign",
          publicKey: "a",
          kind: "transaction",
          bytes: [1, 2, 3],
        },
        {
          id: 1,
          type: "sign",
          publicKey: "a",
          kind: "other",
          bytes: new Uint8Array(1),
        },
        { id: 1, type: "adopt", keys: [key.slice(0, 63)] },
        { id: 1, type: "adopt", keys: [key.map(() => 256)] },
        { id: 1, type: "adopt", keys: "x" },
      ];
      for (const request of bad) expect(isKeyRequest(request)).toBe(false);
    });

    it("accepts each reply shape and rejects the rest", () => {
      const good: unknown[] = [
        { id: 1, ok: true, result: ["a", "b"] },
        { id: 1, ok: true, result: "a" },
        { id: 1, ok: true, result: new Uint8Array(64) },
        // eslint-disable-next-line unicorn/no-null -- the wire's "nothing"
        { id: 1, ok: true, result: null },
        { id: 1, ok: false, error: "no" },
      ];
      for (const reply of good) expect(isKeyReply(reply)).toBe(true);
      const bad: unknown[] = [
        {},
        { id: 1 },
        { id: 1, ok: true },
        { id: 1, ok: true, result: 5 },
        { id: 1, ok: true, result: [1] },
        { id: 1, ok: false },
        { ok: true, result: "a" },
      ];
      for (const reply of bad) expect(isKeyReply(reply)).toBe(false);
    });

    it("recognises the ready and handshake messages", () => {
      const ready = { type: "pg-wallet-keys:ready", version: 1 };
      const connect = { type: "pg-wallet-keys:connect", version: 1 };
      expect(isKeyReady(ready)).toBe(true);
      expect(isKeyReady(connect)).toBe(false);
      expect(isKeyHandshake(connect)).toBe(true);
      expect(isKeyHandshake(ready)).toBe(false);
      expect(isKeyReady({ type: "pg-wallet-keys:ready" })).toBe(false);
      expect(isKeyHandshake(undefined)).toBe(false);
    });
  });
}
