/**
 * The messages the page and the project-code sandbox (`runtime.html`) send
 * each other. Both halves import this module, so they cannot drift.
 *
 * The page opens the conversation: the sandbox posts `ready` on `window`, the
 * page answers with a `MessagePort`, and from then on both sides talk only on
 * that port (`sandbox-frame.ts`). A type-level test (`HasBytes`) proves
 * that no message to the sandbox has a field that can carry key bytes: the
 * only bytes the page ever sends are a 64-byte signature.
 */

/** An account the sandbox may sign as, without its key */
export interface SandboxWallet {
  /** Name of the account or of the standard wallet */
  name: string;
  /** Its key in `pg.wallets` */
  key: string;
  /** Base58 public key */
  publicKey: string;
  /** Whether it is a built-in (Playground) account */
  isPg: boolean;
}

/** What a sign request asks for */
export type SignKind = "transaction" | "message";

/** The page's answer to a sign request */
export type SignReply = { signature: Uint8Array } | { error: string };

/** The page's answer to an RPC request */
export type RpcReply = { status: number; body: string } | { error: string };

const OUTPUT_LEVELS = ["log", "info", "warn", "error", "mocha"] as const;

/** How a line of output is shown in the terminal */
export type OutputLevel = typeof OUTPUT_LEVELS[number];

/** Messages the page sends to the sandbox, on the port */
export type ToSandbox =
  | {
      type: "run";
      /** Transpiled project code (`prepareCode`) */
      code: string;
      /** Whether to run it as a mocha test */
      isTest: boolean;
      /** The project's Anchor IDL, when built */
      idl?: object;
      /** The names `anchor.workspace` lists the program under */
      workspaceNames: string[];
      /** Base58 program id, when the project has one */
      programId?: string;
      /** RPC endpoint */
      endpoint: string;
      /** Commitment of `pg.connection` */
      commitment: string;
      /** Every connected wallet, as `pg.wallets` lists them */
      wallets: SandboxWallet[];
      /** Index of `pg.wallet` in `wallets`, when connected */
      current?: number;
    }
  | { type: "sign"; id: number; reply: SignReply }
  | { type: "rpc"; id: number; reply: RpcReply };

/** Messages the sandbox sends to the page, on the port */
export type FromSandbox =
  | { type: "output"; level: OutputLevel; text: string }
  | { type: "result"; passes: number; failures: number; pending: number }
  | { type: "end" }
  | {
      type: "sign";
      id: number;
      /** Base58 public key of the account to sign as */
      publicKey: string;
      kind: SignKind;
      /** The serialized transaction message, or the message to sign */
      bytes: Uint8Array;
    }
  | {
      type: "rpc";
      id: number;
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string;
    };

/**
 * The handshake on `window`: the sandbox's bundle announces itself, and the
 * page answers it with the port (the only window message it sends)
 */
export const HANDSHAKE = { type: "ready" } as const;

/** Whether a window message is the handshake */
export const isHandshake = (data: unknown): boolean =>
  typeof data === "object" &&
  data !== null &&
  (data as { type?: unknown }).type === HANDSHAKE.type;

/**
 * Whether a type can carry bytes anywhere in it: a typed array, a buffer, or
 * an array of numbers, at any depth. Distributes over unions, so a union with
 * one such member reads `boolean`.
 */
type CarriesBytes<T> = T extends ArrayBuffer | ArrayBufferView
  ? true
  : T extends readonly (infer E)[]
  ? number extends E
    ? true
    : CarriesBytes<E>
  : T extends object
  ? { [K in keyof T]-?: CarriesBytes<T[K]> }[keyof T]
  : false;

/** Whether any part of a type, any union member, can carry bytes */
type HasBytes<T> = true extends CarriesBytes<T> ? true : false;

/** Every message to the sandbox, a sign reply's signature left out */
type ToSandboxBeyondSignature =
  | Exclude<ToSandbox, { type: "sign" }>
  | {
      type: "sign";
      id: number;
      reply: Exclude<SignReply, { signature: Uint8Array }>;
    };

/** Length of an ed25519 signature, the only bytes the page sends */
export const SIGNATURE_LENGTH = 64;

const isRecord = (data: unknown): data is Record<string, unknown> =>
  typeof data === "object" && data !== null;

/** Whether a message to the sandbox has the shape its type names */
export const isToSandbox = (data: unknown): data is ToSandbox => {
  if (!isRecord(data)) return false;
  switch (data.type) {
    case "run":
      return typeof data.code === "string" && Array.isArray(data.wallets);
    case "sign": {
      const reply = data.reply;
      if (typeof data.id !== "number" || !isRecord(reply)) return false;
      if ("signature" in reply) {
        return (
          reply.signature instanceof Uint8Array &&
          reply.signature.length === SIGNATURE_LENGTH
        );
      }
      return typeof reply.error === "string";
    }
    case "rpc":
      return typeof data.id === "number" && isRecord(data.reply);
    default:
      return false;
  }
};

/** Whether a message from the sandbox has the shape its type names */
export const isFromSandbox = (data: unknown): data is FromSandbox => {
  if (!isRecord(data)) return false;
  switch (data.type) {
    case "output":
      return (
        typeof data.text === "string" &&
        OUTPUT_LEVELS.includes(data.level as OutputLevel)
      );
    case "result":
      return typeof data.passes === "number";
    case "end":
      return true;
    case "sign":
      return (
        typeof data.id === "number" &&
        typeof data.publicKey === "string" &&
        (data.kind === "transaction" || data.kind === "message") &&
        data.bytes instanceof Uint8Array
      );
    case "rpc":
      return (
        typeof data.id === "number" &&
        typeof data.url === "string" &&
        typeof data.method === "string" &&
        isRecord(data.headers) &&
        typeof data.body === "string"
      );
    default:
      return false;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, expectTypeOf } = import.meta.vitest;

  describe("utils/js-runtime/protocol", () => {
    it("no message to the sandbox has a field that can hold bytes beyond a sign reply's signature", () => {
      // Checked by the type checker (`yarn test-types`): a field that can
      // hold a typed array, a buffer or a number[] makes this a type error
      expectTypeOf<HasBytes<ToSandboxBeyondSignature>>().toEqualTypeOf<false>();
      // The check sees bytes where they are, nested and optional too
      expectTypeOf<HasBytes<ToSandbox>>().toEqualTypeOf<true>();
      expectTypeOf<HasBytes<{ kp: number[] }>>().toEqualTypeOf<true>();
      expectTypeOf<
        HasBytes<{ wallets: Array<{ kp?: Uint8Array }> }>
      >().toEqualTypeOf<true>();
    });

    it("refuses a sign reply whose bytes are not a 64-byte signature", () => {
      const key = new Uint8Array(32).fill(7);
      expect(
        isToSandbox({ type: "sign", id: 1, reply: { signature: key } })
      ).toBe(false);
      expect(
        isToSandbox({
          type: "sign",
          id: 1,
          reply: { signature: new Uint8Array(SIGNATURE_LENGTH) },
        })
      ).toBe(true);
      expect(
        isToSandbox({
          type: "sign",
          id: 1,
          reply: { signature: new Uint8Array(SIGNATURE_LENGTH * 2) },
        })
      ).toBe(false);
    });

    it("tells the handshake from other window messages", () => {
      expect(isHandshake({ type: "ready" })).toBe(true);
      expect(isHandshake({ type: "sign" })).toBe(false);
      expect(isHandshake("ready")).toBe(false);
    });

    it("refuses an output line of an unknown level and an RPC request without its fields", () => {
      expect(isFromSandbox({ type: "output", level: "x", text: "a" })).toBe(
        false
      );
      expect(isFromSandbox({ type: "output", level: "warn", text: "a" })).toBe(
        true
      );
      expect(
        isFromSandbox({ type: "rpc", id: 1, url: "http://a", body: "{}" })
      ).toBe(false);
      expect(
        isFromSandbox({
          type: "rpc",
          id: 1,
          url: "http://a",
          method: "POST",
          headers: {},
          body: "{}",
        })
      ).toBe(true);
    });

    it("refuses a sign request without the bytes to sign", () => {
      expect(
        isFromSandbox({
          type: "sign",
          id: 1,
          publicKey: "x",
          kind: "transaction",
        })
      ).toBe(false);
    });
  });
}
