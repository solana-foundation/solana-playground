// @vitest-environment node -- a MessageChannel clones bytes into Node's realm, which jsdom's `Uint8Array` does not match

import {
  type FromSandbox,
  isFromSandbox,
  type RpcReply,
  type SignReply,
  type ToSandbox,
} from "./protocol";

/** What the page does with each request the sandbox makes */
export interface SandboxHandlers {
  /** Prints an `output` line */
  print: (output: Extract<FromSandbox, { type: "output" }>) => void;
  /** Signs, or refuses with the reason */
  sign: (request: Extract<FromSandbox, { type: "sign" }>) => Promise<SignReply>;
  /** Carries an RPC request out with the page's `fetch` */
  rpc: (request: Extract<FromSandbox, { type: "rpc" }>) => Promise<RpcReply>;
}

/** A request that names a reply type and an id, whatever else it holds */
type Answerable = { type: "sign" | "rpc"; id: number };

/**
 * Whether a message the sandbox sent is a sign or RPC request with an id the
 * page can answer under, shaped right or not
 */
const isAnswerable = (data: unknown): data is Answerable =>
  typeof data === "object" &&
  data !== null &&
  ((data as { type?: unknown }).type === "sign" ||
    (data as { type?: unknown }).type === "rpc") &&
  typeof (data as { id?: unknown }).id === "number";

/** The reason a handler failed, as the sandbox is told it */
const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Serves one run on the page's side of the port: prints output, answers sign
 * and RPC requests, and ends with the sandbox's `end`. A message that does
 * not have the shape its type names is not acted on; the sandbox runs code
 * nobody vetted. Every sign or RPC request with an id is answered, with an
 * error when it is malformed or its handler fails, so the sandbox never
 * waits on a reply that will not come.
 *
 * @param handlers what the page does with each request
 * @returns a function of the port, resolving when the sandbox posts `end`,
 * with the run's first uncaught error if it had one
 */
export const serveSandboxWith =
  (handlers: SandboxHandlers) =>
  (port: MessagePort): Promise<string | undefined> =>
    new Promise((resolve) => {
      const reply = (message: ToSandbox) => port.postMessage(message);
      const refuse = (request: Answerable) => (error: string) =>
        reply({ type: request.type, id: request.id, reply: { error } });
      port.onmessage = (event: MessageEvent) => {
        const data: unknown = event.data;
        if (!isFromSandbox(data)) {
          if (isAnswerable(data)) {
            refuse(data)(`The ${data.type} request was malformed`);
          }
          return;
        }
        switch (data.type) {
          case "output":
            handlers.print(data);
            return;
          case "result":
            return;
          case "end":
            resolve(data.error);
            return;
          case "sign":
            handlers
              .sign(data)
              .then((answer) =>
                reply({ type: "sign", id: data.id, reply: answer })
              )
              .catch((error: unknown) => refuse(data)(reasonOf(error)));
            return;
          case "rpc":
            handlers
              .rpc(data)
              .then((answer) =>
                reply({ type: "rpc", id: data.id, reply: answer })
              )
              .catch((error: unknown) => refuse(data)(reasonOf(error)));
            return;
        }
      };
    });

if (import.meta.vitest) {
  const { describe, it, expect, afterEach } = import.meta.vitest;

  describe("utils/js-runtime/page-channel", () => {
    const channels: MessageChannel[] = [];
    afterEach(() => {
      for (const channel of channels.splice(0)) {
        channel.port1.close();
        channel.port2.close();
      }
    });

    const refuse = async () => ({ error: "not in this test" });

    /** The sandbox's port, with the page serving it with these handlers */
    const sandboxPortFor = (
      sign: SandboxHandlers["sign"],
      rpc: SandboxHandlers["rpc"]
    ) => {
      const channel = new MessageChannel();
      channels.push(channel);
      void serveSandboxWith({ print: () => undefined, sign, rpc })(
        channel.port2
      );
      return channel.port1;
    };

    /** The next message the page posts on the sandbox's port */
    const nextReply = (port: MessagePort) =>
      new Promise<unknown>((resolve) => {
        port.onmessage = (event) => resolve(event.data);
      });

    it("answers a sign request without its bytes with an error under its id", async () => {
      const port = sandboxPortFor(refuse, refuse);
      const reply = nextReply(port);
      port.postMessage({
        type: "sign",
        id: 7,
        publicKey: "x",
        kind: "message",
        bytes: "hello",
      });
      expect(await reply).toEqual({
        type: "sign",
        id: 7,
        reply: { error: expect.stringContaining("malformed") },
      });
    });

    it("answers an RPC request without its fields with an error under its id", async () => {
      const port = sandboxPortFor(refuse, refuse);
      const reply = nextReply(port);
      port.postMessage({ type: "rpc", id: 3, url: "http://a" });
      expect(await reply).toEqual({
        type: "rpc",
        id: 3,
        reply: { error: expect.stringContaining("malformed") },
      });
    });

    it("answers with the reason when the sign handler rejects", async () => {
      const port = sandboxPortFor(async () => {
        throw new Error("wallet gone");
      }, refuse);
      const reply = nextReply(port);
      port.postMessage({
        type: "sign",
        id: 1,
        publicKey: "x",
        kind: "message",
        bytes: new Uint8Array([1]),
      });
      expect(await reply).toEqual({
        type: "sign",
        id: 1,
        reply: { error: "wallet gone" },
      });
    });

    it("resolves with the error the sandbox's end names, or undefined", async () => {
      const serve = (end: object) => {
        const channel = new MessageChannel();
        channels.push(channel);
        const ended = serveSandboxWith({
          print: () => undefined,
          sign: refuse,
          rpc: refuse,
        })(channel.port2);
        channel.port1.postMessage(end);
        return ended;
      };
      expect(await serve({ type: "end", error: "boom" })).toBe("boom");
      expect(await serve({ type: "end" })).toBeUndefined();
    });

    it("answers with the reason when the RPC handler rejects", async () => {
      const port = sandboxPortFor(refuse, async () => {
        throw new Error("relay broke");
      });
      const reply = nextReply(port);
      port.postMessage({
        type: "rpc",
        id: 2,
        url: "http://a",
        method: "POST",
        headers: {},
        body: "{}",
      });
      expect(await reply).toEqual({
        type: "rpc",
        id: 2,
        reply: { error: "relay broke" },
      });
    });
  });
}
