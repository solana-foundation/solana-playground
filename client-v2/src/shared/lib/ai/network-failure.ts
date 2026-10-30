/**
 * What `fetch`, and a stream it was reading, reject with when the connection
 * drops: a `TypeError` whose whole message is one Chrome ("Failed to fetch",
 * "network error"), Firefox ("NetworkError when attempting to fetch
 * resource.", "Error in input stream"), Safari ("Load failed", "The network
 * connection was lost.") or Node's fetch ("fetch failed", "terminated") use
 * for it. Matched whole, so a programming error that is also a `TypeError`
 * ("x.fetch is not a function") keeps its own message instead of reading as
 * a cut-off reply.
 */
const NETWORK_FAILURE =
  /^(failed to fetch|fetch failed|networkerror when attempting to fetch resource|load failed|network error|the network connection was lost|error in input stream|terminated)\.?$/i;

const isDroppedFetch = (error: unknown) =>
  error instanceof TypeError && NETWORK_FAILURE.test(error.message);

/**
 * Whether `error` is the connection dropping, or the SDK's wrapper around
 * one: it reports a body that fails early as "Failed to process successful
 * response" and a request that never connects as "Cannot connect to API",
 * each an `APICallError` with the `TypeError` as its `cause`.
 */
export const isNetworkFailure = (error: unknown) =>
  isDroppedFetch(error) ||
  (error instanceof Error && isDroppedFetch(error.cause));

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/ai/network-failure", () => {
    it("matches each browser's dropped connection", () => {
      for (const message of [
        "Failed to fetch",
        "NetworkError when attempting to fetch resource.",
        "Load failed",
        "The network connection was lost.",
        "terminated",
      ]) {
        expect(isNetworkFailure(new TypeError(message))).toBe(true);
      }
    });

    it("matches a dropped connection the SDK wrapped", () => {
      const wrapped = new Error("Failed to process successful response", {
        cause: new TypeError("network error"),
      });

      expect(isNetworkFailure(wrapped)).toBe(true);
    });

    it("keeps a programming TypeError, bare or wrapped, apart", () => {
      const bug = new TypeError("x.fetch is not a function");

      expect(isNetworkFailure(bug)).toBe(false);
      expect(isNetworkFailure(new Error("wrapped", { cause: bug }))).toBe(
        false
      );
      expect(isNetworkFailure(new Error("network error"))).toBe(false);
    });
  });
}
