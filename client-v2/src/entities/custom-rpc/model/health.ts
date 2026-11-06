import { createLogger } from "@/shared/lib/logger";

const log = createLogger("custom-rpc:health");

/**
 * What one health request to a typed RPC URL found: an answer of any kind,
 * none in time (or one the browser would not let through), or no request at
 * all because the browser is offline
 */
export type RpcHealth = "answered" | "no_answer" | "offline";

/** How long a typed RPC URL has to answer before it is saved (Spec 07) */
const RPC_CHECK_TIMEOUT_MS = 5000;

/** JSON-RPC `getHealth`: every Solana RPC serves it, and it costs nothing */
const GET_HEALTH = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "getHealth",
});

/**
 * Send one `getHealth` to `url` and wait at most `timeoutMs`. Any HTTP
 * answer the browser lets through counts, whatever its status: a provider's
 * 401 or an unhealthy node is still an RPC that answered. A request that
 * fails (DNS, TLS, CORS) or runs out of time is no answer; the browser does
 * not say which.
 */
const fetchRpcHealthWithin =
  (timeoutMs: number) =>
  async (url: string): Promise<RpcHealth> => {
    if (!navigator.onLine) return "offline";
    // A timer of our own rather than `AbortSignal.timeout`, so the wait
    // follows the test runner's clock
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: GET_HEALTH,
        signal: abort.signal,
      });
      return "answered";
    } catch (error) {
      // The person's URL not answering is their answer, not our failure:
      // logged, never reported, and without the URL, which can hold a key
      log.info("a custom RPC URL did not answer its health check", {
        context: {
          error: error instanceof Error ? error.name : "unknown",
          timedOut: abort.signal.aborted,
        },
      });
      return "no_answer";
    } finally {
      clearTimeout(timer);
    }
  };

/** `fetchRpcHealthWithin` at Spec 07's 5 s */
export const fetchRpcHealth = fetchRpcHealthWithin(RPC_CHECK_TIMEOUT_MS);

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach, beforeAll } = import.meta.vitest;

  describe("entities/custom-rpc/model/health", () => {
    let logger: typeof import("@/shared/lib/logger");
    beforeAll(async () => {
      logger = await import("@/shared/lib/logger");
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const URL = "https://rpc.example.com/?api-key=k";

    it("sends one getHealth POST to the URL", async () => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response('{"result":"ok"}'));
      await fetchRpcHealth(URL);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [to, init] = fetch.mock.calls[0];
      expect(to).toBe(URL);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
      });
    });

    it.each([200, 401, 503])(
      "counts an HTTP %i as an answer",
      async (status) => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response("{}", { status })
        );
        expect(await fetchRpcHealth(URL)).toBe("answered");
      }
    );

    it("reads a failed request as no answer", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new TypeError("Failed to fetch")
      );
      expect(await fetchRpcHealth(URL)).toBe("no_answer");
    });

    it("gives up after 5 s and aborts the request", async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (_, init) =>
          new Promise((_resolve, reject) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      );
      const health = fetchRpcHealth(URL);
      await vi.advanceTimersByTimeAsync(RPC_CHECK_TIMEOUT_MS - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await health).toBe("no_answer");
      expect(signal?.aborted).toBe(true);
    });

    it("counts an answer just inside 5 s, and stops its timer", async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "fetch").mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve(new Response("{}")),
              RPC_CHECK_TIMEOUT_MS - 1
            )
          )
      );
      const health = fetchRpcHealth(URL);
      await vi.advanceTimersByTimeAsync(RPC_CHECK_TIMEOUT_MS - 1);
      expect(await health).toBe("answered");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("sends nothing while the browser is offline", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const fetch = vi.spyOn(globalThis, "fetch");
      expect(await fetchRpcHealth(URL)).toBe("offline");
      expect(fetch).not.toHaveBeenCalled();
    });

    it("never logs the URL, which can hold a provider key", async () => {
      const logged = logger.memoryProvider();
      logger.initLogger({ providers: [logged] });
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new TypeError("Failed to fetch")
      );
      await fetchRpcHealth(URL);
      logger.resetLogger();
      expect(JSON.stringify(logged.entries)).not.toContain("api-key");
    });
  });
}
