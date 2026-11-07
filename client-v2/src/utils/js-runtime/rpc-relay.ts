import type { FromSandbox, RpcReply } from "./protocol";

/** An RPC request from the project-code sandbox */
type RpcRequest = Pick<
  Extract<FromSandbox, { type: "rpc" }>,
  "url" | "method" | "headers" | "body"
>;

/**
 * Sends one encoded transaction to `url` the way web3.js's
 * `Connection.prototype.sendEncodedTransaction` does, over `fetch`
 */
export type SendEncodedWith = (
  fetch: typeof window.fetch
) => (url: string) => (encoded: string) => Promise<unknown>;

/** The encoded transaction of a single JSON-RPC `sendTransaction`, if `body` is one */
const sentTransactionOf = (body: string | undefined): string | undefined => {
  if (body === undefined) return undefined;
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    // Not JSON, so not a send: the relay carries it out as it is
    return undefined;
  }
  const { method, params } = (message ?? {}) as {
    method?: unknown;
    params?: unknown;
  };
  if (method !== "sendTransaction" || !Array.isArray(params)) return undefined;
  return typeof params[0] === "string" ? params[0] : undefined;
};

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : "RPC request failed";

/**
 * Carries the sandbox's RPC requests out with the page's `fetch`, read at
 * each request, since Playnet replaces `window.fetch` with its in-browser
 * answers while it runs.
 *
 * A `sendTransaction` goes out through `sendEncodedWith`, on the page's own
 * web3.js, so whatever watches the page's sends sees the sandbox's too: the
 * tutorial's run reads its transactions off `Connection.prototype`
 * (`captureSends`). The request on the wire is still the sandbox's, byte for
 * byte, and so is the reply it gets back, a refusal included.
 *
 * A request to the playground's own origin is refused: there it would carry
 * the page's cookies to its API, which the sandbox exists to keep out of
 * reach. No request carries credentials anywhere else either.
 *
 * @param fetchNow the page's `fetch` as it is now
 * @returns a function of the send, of the page's origin, then of the request
 */
export const relayRpcWith =
  (fetchNow: () => typeof fetch) =>
  (sendEncodedWith: SendEncodedWith) =>
  (pageOrigin: string) =>
  async (request: RpcRequest): Promise<RpcReply> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return { error: `Not an RPC address: ${request.url}` };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: `Not an RPC address: ${request.url}` };
    }
    if (url.origin === pageOrigin) {
      return { error: "RPC requests to the playground itself are refused" };
    }

    let reply: RpcReply | undefined;
    // web3.js's own request is dropped for the sandbox's, so the RPC sees
    // what the project code sent
    const carry = async (): Promise<Response> => {
      const response = await fetchNow()(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        credentials: "omit",
      });
      const body = await response.text();
      reply = { status: response.status, body };
      return new Response(body, { status: response.status });
    };

    const encoded = sentTransactionOf(request.body);
    try {
      if (encoded === undefined) await carry();
      else await sendEncodedWith(carry)(request.url)(encoded);
    } catch (error) {
      // A send the RPC refused throws here, but its reply is the answer the
      // sandbox's web3.js reads the refusal from
      if (reply) return reply;
      return { error: reasonOf(error) };
    }
    return reply ?? { error: "RPC request failed" };
  };

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("utils/js-runtime/rpc-relay", () => {
    const request = (url: string) => ({
      url,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"getSlot"}',
    });
    const sendBody =
      '{"jsonrpc":"2.0","id":2,"method":"sendTransaction","params":["AQID",{"encoding":"base64"}]}';
    const sendRequest = (url: string) => ({
      url,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: sendBody,
    });
    const unusedSend: SendEncodedWith = () => () => () => {
      throw new Error("Only a sendTransaction goes through the send");
    };
    /** A send that, like web3.js, reads the reply and throws on an RPC error */
    const sendLikeWeb3 =
      (sent: string[]): SendEncodedWith =>
      (fetch) =>
      (url) =>
      async (encoded) => {
        sent.push(encoded);
        const response = await fetch(url, { method: "POST", body: "{}" });
        const json = (await response.json()) as { error?: { message: string } };
        if (json.error) throw new Error(json.error.message);
        return json;
      };

    it("carries a request out with the page's fetch of the moment, without credentials", async () => {
      const fetchSpy = vi.fn(async () => new Response('{"result":1}'));
      const relay = relayRpcWith(() => fetchSpy)(unusedSend)(
        "https://beta.solpg.io"
      );

      const reply = await relay(request("http://playnet"));

      expect(reply).toEqual({ status: 200, body: '{"result":1}' });
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://playnet",
        expect.objectContaining({ credentials: "omit", method: "POST" })
      );
    });

    it("refuses the playground's own origin and anything that is not http", async () => {
      const fetchSpy = vi.fn();
      const relay = relayRpcWith(() => fetchSpy)(unusedSend)(
        "https://beta.solpg.io"
      );

      expect(
        await relay(request("https://beta.solpg.io/api/projects"))
      ).toEqual({ error: "RPC requests to the playground itself are refused" });
      expect(await relay(request("file:///etc/passwd"))).toHaveProperty(
        "error"
      );
      expect(await relay(request("/api/projects"))).toHaveProperty("error");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("sends a sendTransaction through the page's send, with the sandbox's request and reply byte for byte", async () => {
      const answer = '{"jsonrpc":"2.0","id":2,"result":"5ig"}';
      const fetchSpy = vi.fn(async () => new Response(answer));
      const sent: string[] = [];
      const relay = relayRpcWith(() => fetchSpy)(sendLikeWeb3(sent))(
        "https://beta.solpg.io"
      );

      expect(await relay(sendRequest("https://api.devnet.solana.com"))).toEqual(
        { status: 200, body: answer }
      );
      expect(sent).toEqual(["AQID"]);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.devnet.solana.com",
        expect.objectContaining({ body: sendBody, credentials: "omit" })
      );
    });

    it("answers a refused send with the RPC's reply, not the send's throw", async () => {
      const refusal =
        '{"jsonrpc":"2.0","id":2,"error":{"code":-32002,"message":"Transaction simulation failed","data":{"logs":["Program log: no"]}}}';
      const relay = relayRpcWith(() =>
        vi.fn(async () => new Response(refusal))
      )(sendLikeWeb3([]))("https://beta.solpg.io");

      expect(await relay(sendRequest("https://api.devnet.solana.com"))).toEqual(
        { status: 200, body: refusal }
      );
    });

    it("answers a failed fetch with its reason", async () => {
      const relay = relayRpcWith(() =>
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        })
      )(unusedSend)("https://beta.solpg.io");

      expect(await relay(request("https://api.devnet.solana.com"))).toEqual({
        error: "Failed to fetch",
      });
    });
  });
}
