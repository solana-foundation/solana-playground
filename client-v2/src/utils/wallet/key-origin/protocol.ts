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
 * The key page's answer: `accounts` and `adopt` give public keys, `create` the
 * public key of the key it made and stored, `sign` the 64 signature bytes,
 * `forget` `null`. Never key bytes.
 */
export type KeyReply = {
  id: number;
} & ( // eslint-disable-next-line unicorn/no-null -- `forget` answers "nothing" on the wire
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

/**
 * @param x a parsed value
 * @returns whether it is a key's 64 secret bytes as numbers
 */
export const isSecretKey = (x: unknown): x is number[] =>
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

const SIGNATURE_LENGTH = 64;

/**
 * Takes a reply's `result` as the shape its request answers with. The wire
 * check (`isKeyReply`) accepts any request's result shape, so each caller
 * checks the one it asked for before using it.
 *
 * @param isResult whether a result has the request's shape
 * @returns for the request, as the error names it, a function of the
 * result, which gives it back typed
 * @throws when the result has another shape
 */
const resultFor =
  <T>(isResult: (x: unknown) => x is T) =>
  (what: string) =>
  (result: unknown): T => {
    if (!isResult(result)) {
      throw new Error(
        `The wallet's key page answered ${what} with a reply of the wrong shape.`
      );
    }
    return result;
  };

const isPublicKeys = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every(isString);

const isSignature = (x: unknown): x is Uint8Array =>
  x instanceof Uint8Array && x.length === SIGNATURE_LENGTH;

/** A `create` reply's result: the new key's public key */
export const createdKeyOf = resultFor(isString)("create");

/** A `sign` reply's result: the 64 signature bytes */
export const signatureOf = resultFor(isSignature)("sign");

/** An `accounts` or `adopt` reply's result: every public key the key page holds */
export const publicKeysOf = resultFor(isPublicKeys)("adopt");

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

/** The design tokens the key page's panel button is drawn with */
export const THEME_TOKENS = [
  "bg",
  "fg",
  "border",
  "radius",
  "font",
  "focus",
  "height",
  "padding",
  "fontSize",
  "fontWeight",
  "hoverBg",
  "hoverFg",
  "ring",
] as const;

/** Values of the panel's design tokens, as CSS values; any may be missing */
export type ThemeTokens = Partial<Record<typeof THEME_TOKENS[number], string>>;

/**
 * What goes over the visible panel's port: the page sends `theme` and `name`
 * (the account's name, which the key file is named after), the panel sends the
 * rest. `imported` names the key the panel stored, never its bytes, and says
 * whether the key page held it before; `escape` is Escape pressed in the
 * panel, which the dialog around it never hears otherwise.
 */
export type PanelMessage =
  | { type: "theme"; tokens: ThemeTokens }
  | { type: "name"; name: string }
  | { type: "imported"; publicKey: string; isNew: boolean }
  | { type: "exported" }
  | { type: "error"; message: string }
  | { type: "busy"; busy: boolean }
  | { type: "escape" };

/**
 * @param x a parsed value
 * @returns whether it is a set of theme tokens: known names, string values
 */
export const isThemeTokens = (x: unknown): x is ThemeTokens =>
  isRecord(x) &&
  Object.entries(x).every(
    ([name, value]) =>
      (THEME_TOKENS as readonly string[]).includes(name) && isString(value)
  );

/**
 * @param x a message received over the panel's port
 * @returns whether it is a well-formed panel message
 */
export const isPanelMessage = (x: unknown): x is PanelMessage => {
  if (!isRecord(x)) return false;
  switch (x.type) {
    case "theme":
      return isThemeTokens(x.tokens);
    case "name":
      return isString(x.name);
    case "imported":
      return isString(x.publicKey) && typeof x.isNew === "boolean";
    case "exported":
    case "escape":
      return true;
    case "error":
      return isString(x.message);
    case "busy":
      return typeof x.busy === "boolean";
    default:
      return false;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/wallet/key-origin/protocol", () => {
    const key = Array.from({ length: 64 }, (_, i) => i);

    it("accepts each request shape", () => {
      const requests: unknown[] = [
        { id: 1, type: "accounts" },
        { id: 2, type: "create" },
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
        { id: 1, type: "keep", publicKey: "abc" },
        { id: 1, type: "forget" },
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

    it("checks each request's result for the shape it answers with", () => {
      const signature = new Uint8Array(64);
      expect(createdKeyOf("pk")).toBe("pk");
      expect(signatureOf(signature)).toBe(signature);
      expect(publicKeysOf(["a", "b"])).toEqual(["a", "b"]);
      const wrong: Array<[(x: unknown) => unknown, unknown]> = [
        [createdKeyOf, ["pk"]],
        [createdKeyOf, new Uint8Array(64)],
        // eslint-disable-next-line unicorn/no-null -- the wire's "nothing"
        [createdKeyOf, null],
        [signatureOf, new Uint8Array(63)],
        [signatureOf, "sig"],
        [signatureOf, Array.from(signature)],
        [publicKeysOf, "a"],
        [publicKeysOf, new Uint8Array(64)],
        [publicKeysOf, [1]],
      ];
      for (const [check, result] of wrong) {
        expect(() => check(result)).toThrow("a reply of the wrong shape");
      }
    });

    it("accepts each panel message and rejects the rest", () => {
      const good: unknown[] = [
        { type: "theme", tokens: { bg: "#000", fontSize: "14px" } },
        { type: "theme", tokens: {} },
        { type: "theme", tokens: { hoverBg: "#111", ring: "#222" } },
        { type: "name", name: "Wallet 2" },
        { type: "imported", publicKey: "abc", isNew: true },
        { type: "imported", publicKey: "abc", isNew: false },
        { type: "exported" },
        { type: "error", message: "no" },
        { type: "busy", busy: true },
        { type: "escape" },
      ];
      for (const message of good) expect(isPanelMessage(message)).toBe(true);
      const bad: unknown[] = [
        undefined,
        { type: "theme" },
        { type: "theme", tokens: { bg: 1 } },
        { type: "theme", tokens: { colour: "#000" } },
        { type: "name" },
        { type: "imported" },
        { type: "imported", publicKey: "abc" },
        { type: "imported", publicKey: "abc", isNew: "yes" },
        { type: "error" },
        { type: "busy", busy: "yes" },
        { type: "other" },
      ];
      for (const message of bad) expect(isPanelMessage(message)).toBe(false);
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
