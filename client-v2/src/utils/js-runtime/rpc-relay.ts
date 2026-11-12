import { createLogger } from "@/shared/lib/logger";

import { PgWeb3 } from "../web3";
import type { FromSandbox, RpcReply } from "./protocol";

const log = createLogger("js-runtime:rpc-relay");

/** An RPC request from the project-code sandbox */
type RpcRequest = Pick<
  Extract<FromSandbox, { type: "rpc" }>,
  "url" | "method" | "headers" | "body"
>;

/**
 * Calls web3.js's `sendEncodedTransaction` for a send the RPC has already
 * answered, so a hook on `Connection.prototype` sees it. `fetch` stands in
 * for the network and hands back that answer: the send must not go out
 * again, so it takes no arguments.
 */
export type SendEncodedWith = (
  fetch: () => Promise<Response>
) => (url: string) => (encoded: string) => Promise<unknown>;

/**
 * The page's own web3.js send. Retries on 429 are off, though the answer
 * it reads is always one the RPC already gave, so `fetch` runs once.
 */
export const sendEncodedOnPage: SendEncodedWith =
  (fetch) => (url) => (encoded) =>
    new PgWeb3.Connection(url, {
      fetch,
      disableRetryOnRateLimit: true,
    }).sendEncodedTransaction(encoded);

/**
 * The transaction of a single JSON-RPC `sendTransaction` in base64, the
 * encoding a `Connection.prototype` hook reads; any other request, a batch
 * or a base58 send included, is only carried out
 */
const sentTransactionOf = (body: string | undefined): string | undefined => {
  if (body === undefined) return undefined;
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    // Not JSON, so not a send: the relay carries it out as it is. The
    // parser's message quotes the body, so it stays out of the log
    log.debug("request body is not JSON; relayed as is");
    return undefined;
  }
  const { method, params } = (message ?? {}) as {
    method?: unknown;
    params?: unknown;
  };
  if (method !== "sendTransaction" || !Array.isArray(params)) return undefined;
  const [encoded, config] = params as [unknown, { encoding?: unknown }?];
  if (typeof encoded !== "string" || config?.encoding !== "base64") {
    return undefined;
  }
  return encoded;
};

/** Whether `body` is a JSON-RPC error, the answer a refused send throws on */
const isRpcError = (body: string) => {
  try {
    return (
      (JSON.parse(body) as { error?: unknown } | null)?.error !== undefined
    );
  } catch {
    // Not JSON-RPC at all: whatever threw on it is not a refusal. The
    // parser's message quotes the body, so it stays out of the log
    log.debug("reply body is not JSON; not a refusal");
    return false;
  }
};

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : "RPC request failed";

/**
 * Carries the sandbox's RPC requests out with the page's `fetch`, read at
 * each request, since Playnet replaces `window.fetch` with its in-browser
 * answers while it runs. The sandbox gets the RPC's status and body back
 * as they came, a refusal included.
 *
 * A base64 `sendTransaction` the RPC answered (2xx) is then handed to
 * `sendEncodedWith` with that answer, so whatever watches the page's sends
 * sees the sandbox's transaction too: the tutorial's run reads them off
 * `Connection.prototype` (`captureSends`). The send never reaches the
 * network a second time, and a reply the RPC did not give, a 429 or a 5xx,
 * is no send at all: the sandbox's own client retries it.
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

    let reply: { status: number; body: string };
    try {
      const response = await fetchNow()(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        credentials: "omit",
      });
      reply = { status: response.status, body: await response.text() };
    } catch (error) {
      return { error: reasonOf(error) };
    }

    const encoded = sentTransactionOf(request.body);
    if (encoded === undefined || reply.status < 200 || reply.status >= 300) {
      return reply;
    }
    try {
      await sendEncodedWith(
        async () => new Response(reply.body, { status: reply.status })
      )(request.url)(encoded);
    } catch (error) {
      // A refused send throws by design; anything else means the page did
      // not see a send the RPC took, which the tutorial's run then misses
      if (!isRpcError(reply.body)) {
        log.error(error, { report: true, context: { url: request.url } });
      }
    }
    return reply;
  };

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, afterEach } = import.meta.vitest;

  describe("utils/js-runtime/rpc-relay", () => {
    let initLogger: typeof import("@/shared/lib/logger").initLogger;
    let resetLogger: typeof import("@/shared/lib/logger").resetLogger;
    let memoryProvider: typeof import("@/shared/lib/logger").memoryProvider;
    beforeAll(async () => {
      ({ initLogger, resetLogger, memoryProvider } = await import(
        "@/shared/lib/logger"
      ));
    });
    afterEach(() => resetLogger());

    const ORIGIN = "https://beta.solpg.io";
    const DEVNET = "https://api.devnet.solana.com";
    const request = (url: string) => ({
      url,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"getSlot"}',
    });
    const sendBodyOf = (config: string) =>
      `{"jsonrpc":"2.0","id":2,"method":"sendTransaction","params":["AQID"${config}]}`;
    const sendBody = sendBodyOf(',{"encoding":"base64"}');
    const sendRequestOf = (body: string) => ({
      url: DEVNET,
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const sendRequest = sendRequestOf(sendBody);
    const ANSWER = '{"jsonrpc":"2.0","id":2,"result":"5ig"}';
    const REFUSAL =
      '{"jsonrpc":"2.0","id":2,"error":{"code":-32002,"message":"Transaction simulation failed","data":{"logs":["Program log: no"]}}}';
    const unusedSend: SendEncodedWith = () => () => () => {
      throw new Error("Only a sendTransaction goes through the send");
    };
    /** A send that, like web3.js, reads the reply and throws on an RPC error */
    const sendLikeWeb3 =
      (sent: string[]): SendEncodedWith =>
      (fetch) =>
      () =>
      async (encoded) => {
        sent.push(encoded);
        const json = (await (await fetch()).json()) as {
          error?: { message: string };
        };
        if (json.error) throw new Error(json.error.message);
        return json;
      };
    const answeringWith = (status: number) => (body: string) =>
      vi.fn(async () => new Response(body, { status }));
    const answering = answeringWith(200);

    it("carries a request out with the page's fetch of the moment, without credentials", async () => {
      const fetchSpy = answering('{"result":1}');
      const relay = relayRpcWith(() => fetchSpy)(unusedSend)(ORIGIN);

      const reply = await relay(request("http://playnet"));

      expect(reply).toEqual({ status: 200, body: '{"result":1}' });
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://playnet",
        expect.objectContaining({ credentials: "omit", method: "POST" })
      );
    });

    it("refuses the playground's own origin and anything that is not http", async () => {
      const fetchSpy = vi.fn();
      const relay = relayRpcWith(() => fetchSpy)(unusedSend)(ORIGIN);

      expect(
        await relay(request("https://beta.solpg.io/api/projects"))
      ).toEqual({ error: "RPC requests to the playground itself are refused" });
      expect(await relay(request("file:///etc/passwd"))).toHaveProperty(
        "error"
      );
      expect(await relay(request("/api/projects"))).toHaveProperty("error");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("hands an answered base64 send to the page's send, once, with the sandbox's request and reply byte for byte", async () => {
      const fetchSpy = answering(ANSWER);
      const sent: string[] = [];
      const relay = relayRpcWith(() => fetchSpy)(sendLikeWeb3(sent))(ORIGIN);

      expect(await relay(sendRequest)).toEqual({ status: 200, body: ANSWER });
      expect(sent).toEqual(["AQID"]);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledWith(
        DEVNET,
        expect.objectContaining({ body: sendBody, credentials: "omit" })
      );
    });

    it("hands a refused send to the page's send too, and answers with the RPC's reply", async () => {
      const logged = memoryProvider();
      initLogger({ providers: [logged] });
      const sent: string[] = [];
      const relay = relayRpcWith(() => answering(REFUSAL))(sendLikeWeb3(sent))(
        ORIGIN
      );

      expect(await relay(sendRequest)).toEqual({ status: 200, body: REFUSAL });
      expect(sent).toEqual(["AQID"]);
      expect(logged.entries).toEqual([]);
    });

    it("keeps a send the RPC did not answer, such as a 429, from the page's send", async () => {
      const sent: string[] = [];
      const relay = relayRpcWith(() => answeringWith(429)("rate"))(
        sendLikeWeb3(sent)
      )(ORIGIN);

      expect(await relay(sendRequest)).toEqual({ status: 429, body: "rate" });
      expect(sent).toEqual([]);
    });

    it("keeps a send not encoded in base64 from the page's send", async () => {
      const sent: string[] = [];
      const relay = relayRpcWith(() => answering(ANSWER))(sendLikeWeb3(sent))(
        ORIGIN
      );

      await relay(sendRequestOf(sendBodyOf("")));
      await relay(sendRequestOf(sendBodyOf(',{"encoding":"base58"}')));

      expect(sent).toEqual([]);
    });

    it("reports a page send that throws on an answered send, and still answers the sandbox", async () => {
      const logged = memoryProvider();
      initLogger({ providers: [logged] });
      const relay = relayRpcWith(() => answering(ANSWER))(() => () => () => {
        throw new TypeError("hook broke");
      })(ORIGIN);

      expect(await relay(sendRequest)).toEqual({ status: 200, body: ANSWER });
      expect(logged.entries).toEqual([
        expect.objectContaining({ level: "error", report: true }),
      ]);
    });

    it("answers a failed fetch with its reason, whatever was thrown", async () => {
      const failing = (thrown: unknown) =>
        relayRpcWith(() =>
          vi.fn(async () => {
            throw thrown;
          })
        )(unusedSend)(ORIGIN);

      expect(
        await failing(new TypeError("Failed to fetch"))(sendRequest)
      ).toEqual({ error: "Failed to fetch" });
      // eslint-disable-next-line @typescript-eslint/no-throw-literal -- Playnet's fetch may reject with a non-Error
      expect(await failing("gone")(sendRequest)).toEqual({
        error: "RPC request failed",
      });
    });

    it("lets a hook on the page's Connection.prototype see the send, with one request on the wire", async () => {
      const seen: string[] = [];
      const proto = PgWeb3.Connection.prototype;
      const original = proto.sendEncodedTransaction;
      vi.spyOn(proto, "sendEncodedTransaction").mockImplementation(
        async function (
          this: InstanceType<typeof PgWeb3.Connection>,
          encoded: string
        ) {
          seen.push(encoded);
          return original.call(this, encoded);
        }
      );
      const fetchSpy = answering(ANSWER);
      const relay = relayRpcWith(() => fetchSpy)(sendEncodedOnPage)(ORIGIN);

      expect(await relay(sendRequest)).toEqual({ status: 200, body: ANSWER });
      expect(seen).toEqual(["AQID"]);
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });
}
