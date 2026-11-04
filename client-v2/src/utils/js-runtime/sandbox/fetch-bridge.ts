// @vitest-environment node -- noble checks `instanceof Uint8Array`, which jsdom's realm fails

/**
 * Every JSON-RPC request made in the sandbox goes through the page.
 *
 * `global-fetch.ts` routes `globalThis.fetch` here, for web3.js too. The page
 * carries the request out with its own `window.fetch`, which Playnet replaces
 * with in-browser answers, so Playnet works from the sandbox, and the
 * sandbox's `null` origin never meets CORS. Before the request leaves, real signatures replace the
 * placeholders of `tx.sign(pg.wallet.keypair)` (`placeholders.ts`).
 *
 * Anything that is not JSON-RPC goes out through the sandbox's own `fetch`,
 * from its opaque origin, so the page's origin and cookies lend it nothing.
 */
import type { RpcReply } from "../protocol";
import type { RpcRequest } from "./channel";
import { nativeFetch, setGlobalFetch } from "./global-fetch";
import { spliceRpcBody } from "./placeholders";

type SendRpc = (request: RpcRequest) => Promise<RpcReply>;

let attach: (send: SendRpc) => void = () => undefined;
const sendRpc = new Promise<SendRpc>((resolve) => {
  attach = resolve;
});

/**
 * Starts carrying RPC requests to the page, once the channel is open. A
 * request made earlier waits for it.
 *
 * @param send hands one request to the page
 */
export const bridgeRpcThrough = (send: SendRpc) => attach(send);

/** Statuses whose response must have no body */
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** The JSON-RPC request in a body, or `undefined` for anything else */
const rpcBodyOf = (body: string) => {
  const text = body.trimStart();
  if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON, so not JSON-RPC: it goes out as any other request
    return undefined;
  }
  const requests = Array.isArray(parsed) ? parsed : [parsed];
  const isRpc = requests.every(
    (request) =>
      typeof request === "object" && request !== null && "jsonrpc" in request
  );
  return isRpc ? (parsed as object | object[]) : undefined;
};

/** The URL a `fetch` is made to */
const urlOf = (input: RequestInfo | URL) => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

/**
 * The text body of a `fetch`: `init`'s when it is text, the `Request`'s when
 * `init` has none, or `undefined` for a body that is not text (or none)
 */
const textBodyOf = async (
  request: Request | undefined,
  init: RequestInit | undefined
) => {
  if (typeof init?.body === "string") return init.body;
  if (request && !init?.body) return request.clone().text();
  return undefined;
};

/**
 * A `fetch` that hands JSON-RPC to the page, with real signatures spliced in,
 * and sends anything else with the sandbox's own `fetch`.
 *
 * @param native the sandbox's own `fetch`
 * @returns a function of how to reach the page's side, then the `fetch`
 */
const bridgedFetchWith =
  (native: typeof fetch) =>
  (sendRpcOf: () => Promise<SendRpc>): typeof fetch =>
  async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const body = await textBodyOf(request, init);
    const rpc = body === undefined ? undefined : rpcBodyOf(body);
    if (rpc === undefined) return native(input, init);

    const spliced = Array.isArray(rpc)
      ? await Promise.all(rpc.map(spliceRpcBody))
      : await spliceRpcBody(rpc);
    const send = await sendRpcOf();
    const reply = await send({
      url: urlOf(input),
      method: init?.method ?? request?.method ?? "POST",
      headers: Object.fromEntries(
        new Headers(init?.headers ?? request?.headers).entries()
      ),
      body: JSON.stringify(spliced),
    });
    // What `fetch` does on a network failure
    if ("error" in reply) throw new TypeError(reply.error);
    return new Response(
      // eslint-disable-next-line unicorn/no-null -- a body-less `Response` takes `null`
      NO_BODY_STATUSES.has(reply.status) ? null : reply.body,
      {
        status: reply.status,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

setGlobalFetch(bridgedFetchWith(nativeFetch)(() => sendRpc));

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll } = import.meta.vitest;

  describe("utils/js-runtime/sandbox/fetch-bridge", () => {
    type Web3 = typeof import("@solana/web3.js");
    let web3: Web3;
    let ed25519: typeof import("@noble/ed25519");
    let sandboxKeypairWith: typeof import("../../wallet/sandbox-signer-provider").sandboxKeypairWith;

    beforeAll(async () => {
      web3 = await import("@solana/web3.js");
      ed25519 = await import("@noble/ed25519");
      ({ sandboxKeypairWith } = await import(
        "../../wallet/sandbox-signer-provider"
      ));
      const { patchWeb3 } = await import("./placeholders");
      patchWeb3(web3);
    });

    const URL_OF_RPC = "http://localhost:8899/";

    /**
     * A transaction signed synchronously with a sandbox keypair: it holds a
     * placeholder, and `signed` resolves once the real signature is in
     */
    const placeholderSigned = () => {
      const keypair = web3.Keypair.generate();
      const sandboxKeypair = sandboxKeypairWith(
        () => () => async (bytes) =>
          ed25519.sign(bytes, keypair.secretKey.slice(0, 32))
      )(keypair.publicKey);
      const tx = new web3.Transaction({
        feePayer: keypair.publicKey,
        recentBlockhash: web3.Keypair.generate().publicKey.toBase58(),
      }).add(
        web3.SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: web3.Keypair.generate().publicKey,
          lamports: 1,
        })
      );
      const signed = tx.sign(sandboxKeypair) as unknown as Promise<void>;
      const placeholder = Uint8Array.from(tx.signature ?? []);
      const sendBody = {
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [tx.serialize().toString("base64"), { encoding: "base64" }],
      };
      /** The real signature, once the page answered */
      const real = async () => {
        await signed;
        return Uint8Array.from(tx.signature ?? []);
      };
      return { sendBody, placeholder, real };
    };

    /** The first signature of a `sendTransaction` request's transaction */
    const signatureSent = (request: { params: [string] }) =>
      Uint8Array.from(
        web3.Transaction.from(Buffer.from(request.params[0], "base64"))
          .signature ?? []
      );

    /** A bridged fetch whose page side and native fetch the test records */
    const bridged = () => {
      const send = vi.fn<SendRpc>(async () => ({
        status: 200,
        body: '{"jsonrpc":"2.0","id":1,"result":"ok"}',
      }));
      const native = vi.fn(async () => new Response("native"));
      const fetchWith = bridgedFetchWith(native as unknown as typeof fetch)(
        async () => send
      );
      return { fetchWith, send, native };
    };

    it("splices the real signature into every request of a batch", async () => {
      const { fetchWith, send } = bridged();
      const { sendBody, placeholder, real } = placeholderSigned();
      const balance = {
        jsonrpc: "2.0",
        id: 2,
        method: "getBalance",
        params: ["x"],
      };

      await fetchWith(URL_OF_RPC, {
        method: "POST",
        body: JSON.stringify([sendBody, balance]),
      });

      const [sent] = send.mock.calls[0];
      const [sentTx, sentBalance] = JSON.parse(sent.body);
      expect(signatureSent(sentTx)).not.toEqual(placeholder);
      expect(signatureSent(sentTx)).toEqual(await real());
      expect(sentBalance).toEqual(balance);
    });

    it("reads the body, URL, method and headers of a Request", async () => {
      const { fetchWith, send } = bridged();
      const { sendBody, real } = placeholderSigned();

      await fetchWith(
        new Request(URL_OF_RPC, {
          method: "POST",
          headers: { "content-type": "application/json", "x-extra": "1" },
          body: JSON.stringify(sendBody),
        })
      );

      const [sent] = send.mock.calls[0];
      expect(sent.url).toBe(URL_OF_RPC);
      expect(sent.method).toBe("POST");
      expect(sent.headers).toEqual({
        "content-type": "application/json",
        "x-extra": "1",
      });
      expect(signatureSent(JSON.parse(sent.body))).toEqual(await real());
    });

    it("sends anything that is not JSON-RPC through the sandbox's own fetch", async () => {
      const { fetchWith, send, native } = bridged();

      await fetchWith("http://example.com/a.json");
      await fetchWith(URL_OF_RPC, { method: "POST", body: "not json" });
      await fetchWith(URL_OF_RPC, {
        method: "POST",
        body: JSON.stringify({ hello: "world" }),
      });

      expect(native).toHaveBeenCalledTimes(3);
      expect(send).not.toHaveBeenCalled();
    });

    it("fails as fetch does on a network failure when the page refuses", async () => {
      const { fetchWith, send } = bridged();
      send.mockResolvedValueOnce({ error: "relay refused" });

      await expect(
        fetchWith(URL_OF_RPC, {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }),
        })
      ).rejects.toThrow(new TypeError("relay refused"));
    });
  });
}
