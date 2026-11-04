import type { FromSandbox, RpcReply } from "./protocol";

/** An RPC request from the project-code sandbox */
type RpcRequest = Pick<
  Extract<FromSandbox, { type: "rpc" }>,
  "url" | "method" | "headers" | "body"
>;

/**
 * Carries the sandbox's RPC requests out with the page's `fetch`, read at
 * each request, since Playnet replaces `window.fetch` with its in-browser
 * answers while it runs.
 *
 * A request to the playground's own origin is refused: there it would carry
 * the page's cookies to its API, which the sandbox exists to keep out of
 * reach. No request carries credentials anywhere else either.
 *
 * @param fetchNow the page's `fetch` as it is now
 * @returns a function of the page's origin, then of the request
 */
export const relayRpcWith =
  (fetchNow: () => typeof fetch) =>
  (pageOrigin: string) =>
  async (request: RpcRequest): Promise<RpcReply> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (error) {
      return { error: `Not an RPC address: ${request.url}` };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: `Not an RPC address: ${request.url}` };
    }
    if (url.origin === pageOrigin) {
      return { error: "RPC requests to the playground itself are refused" };
    }

    try {
      const response = await fetchNow()(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        credentials: "omit",
      });
      return { status: response.status, body: await response.text() };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "RPC request failed",
      };
    }
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

    it("carries a request out with the page's fetch of the moment, without credentials", async () => {
      const fetchSpy = vi.fn(async () => new Response('{"result":1}'));
      const relay = relayRpcWith(() => fetchSpy)("https://beta.solpg.io");

      const reply = await relay(request("http://playnet"));

      expect(reply).toEqual({ status: 200, body: '{"result":1}' });
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://playnet",
        expect.objectContaining({ credentials: "omit", method: "POST" })
      );
    });

    it("refuses the playground's own origin and anything that is not http", async () => {
      const fetchSpy = vi.fn();
      const relay = relayRpcWith(() => fetchSpy)("https://beta.solpg.io");

      expect(
        await relay(request("https://beta.solpg.io/api/projects"))
      ).toEqual({ error: "RPC requests to the playground itself are refused" });
      expect(await relay(request("file:///etc/passwd"))).toHaveProperty(
        "error"
      );
      expect(await relay(request("/api/projects"))).toHaveProperty("error");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("answers a failed fetch with its reason", async () => {
      const relay = relayRpcWith(() =>
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        })
      )("https://beta.solpg.io");

      expect(await relay(request("https://api.devnet.solana.com"))).toEqual({
        error: "Failed to fetch",
      });
    });
  });
}
