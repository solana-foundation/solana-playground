import type { PublicKey } from "@solana/web3.js";

import {
  type FromSandbox,
  HANDSHAKE,
  isHandshake,
  isToSandbox,
  type RpcReply,
  type SignKind,
  type SignReply,
  type ToSandbox,
} from "../protocol";

/** The run the page asks for */
export type RunMessage = Extract<ToSandbox, { type: "run" }>;

/** An RPC request the sandbox hands the page */
export type RpcRequest = Omit<
  Extract<FromSandbox, { type: "rpc" }>,
  "type" | "id"
>;

/**
 * Announces the sandbox to the page and waits for the private port.
 *
 * Only the parent's answer counts: a message from any other window, or one
 * without a port, is ignored, and the listener goes away with the first port.
 *
 * @param parent the page's window
 * @returns a function of the sandbox's own window
 */
export const awaitPortFrom =
  (parent: Window) =>
  (self: Window): Promise<MessagePort> =>
    new Promise((resolve) => {
      const handleMessage = (event: MessageEvent) => {
        const [port] = event.ports;
        if (event.source !== parent || !isHandshake(event.data) || !port) {
          return;
        }
        self.removeEventListener("message", handleMessage);
        resolve(port);
      };
      self.addEventListener("message", handleMessage);
      // The page's origin is the only one we may not name from an opaque
      // origin's point of view, so `"*"`; the message carries nothing
      parent.postMessage(HANDSHAKE, "*");
    });

/**
 * The sandbox's side of the port: posts output, asks the page to sign or to
 * make an RPC request, and hands each `run` to its handler.
 *
 * @param port the private port the page handed over
 * @returns the channel
 */
export const channelFor = (port: MessagePort) => {
  let nextId = 1;
  const waiting = new Map<number, (reply: SignReply | RpcReply) => void>();
  let handleRun: ((run: RunMessage) => void) | undefined;

  port.onmessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (!isToSandbox(data)) return;
    if (data.type === "run") {
      handleRun?.(data);
      return;
    }
    const resolve = waiting.get(data.id);
    waiting.delete(data.id);
    resolve?.(data.reply);
  };

  const ask = <R extends SignReply | RpcReply>(
    message:
      | Omit<Extract<FromSandbox, { type: "sign" }>, "id">
      | Omit<Extract<FromSandbox, { type: "rpc" }>, "id">
  ) =>
    new Promise<R>((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve as (reply: SignReply | RpcReply) => void);
      port.postMessage({ ...message, id });
    });

  return {
    post: (message: FromSandbox) => port.postMessage(message),

    /** Asks the page to sign; rejects with the page's refusal */
    sign:
      (publicKey: PublicKey) =>
      (kind: SignKind) =>
      async (bytes: Uint8Array) => {
        const reply = await ask<SignReply>({
          type: "sign",
          publicKey: publicKey.toBase58(),
          kind,
          bytes,
        });
        if ("error" in reply) throw new Error(reply.error);
        return reply.signature;
      },

    /** Hands an RPC request to the page */
    rpc: (request: RpcRequest) => ask<RpcReply>({ type: "rpc", ...request }),

    onRun: (handler: (run: RunMessage) => void) => {
      handleRun = handler;
    },
  };
};

/** The sandbox's side of the port */
export type SandboxChannel = ReturnType<typeof channelFor>;
