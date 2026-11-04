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

/**
 * Serves one run on the page's side of the port: prints output, answers sign
 * and RPC requests, and ends with the sandbox's `end`. A message that does
 * not have the shape its type names is dropped; the sandbox runs code
 * nobody vetted.
 *
 * @param handlers what the page does with each request
 * @returns a function of the port, resolving when the sandbox posts `end`
 */
export const serveSandboxWith =
  (handlers: SandboxHandlers) =>
  (port: MessagePort): Promise<void> =>
    new Promise((resolve) => {
      const reply = (message: ToSandbox) => port.postMessage(message);
      port.onmessage = (event: MessageEvent) => {
        const data: unknown = event.data;
        if (!isFromSandbox(data)) return;
        switch (data.type) {
          case "output":
            handlers.print(data);
            return;
          case "result":
            return;
          case "end":
            resolve();
            return;
          case "sign":
            void handlers
              .sign(data)
              .then((answer) =>
                reply({ type: "sign", id: data.id, reply: answer })
              );
            return;
          case "rpc":
            void handlers
              .rpc(data)
              .then((answer) =>
                reply({ type: "rpc", id: data.id, reply: answer })
              );
            return;
        }
      };
    });
