import type { Cluster } from "../../utils";

/**
 * The endpoint as the message shows it: its origin only, since a provider's
 * URL often carries an API key in its query
 */
const originOf = (endpoint: string) => {
  try {
    return new URL(endpoint).origin;
  } catch {
    // Not a URL the browser could have fetched: nothing worth showing
    return null;
  }
};

/**
 * What the list says when the signatures could not be read. A `TypeError` is
 * taken as a network-level failure, the way `fetch` reports one whatever the
 * browser words it as ("Failed to fetch", "Load failed"): nothing answered,
 * or the browser refused the answer. That case names the endpoint, and on
 * localnet asks about the validator, instead of repeating the browser's
 * words. Anything else keeps its own message.
 */
export const describeTxsError = (
  error: unknown,
  { endpoint, cluster }: { endpoint: string; cluster: Cluster | null }
) => {
  if (error instanceof TypeError) {
    const origin = originOf(endpoint);
    const unreachable = origin
      ? `Can't reach the RPC endpoint at ${origin}.`
      : "Can't reach the RPC endpoint.";
    return cluster === "localnet"
      ? `${unreachable} Is the local validator running?`
      : unreachable;
  }
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return `Connection error: ${
    typeof message === "string" && message ? message : "Unknown error"
  }`;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("components/Wallet/txs-error", () => {
    const devnet = "https://api.devnet.solana.com";
    const local = "http://localhost:8899";

    it("names a local endpoint that does not answer, and the validator", () => {
      expect(
        describeTxsError(new TypeError("Failed to fetch"), {
          endpoint: local,
          cluster: "localnet",
        })
      ).toBe(
        "Can't reach the RPC endpoint at http://localhost:8899. Is the local validator running?"
      );
    });

    it("names a public endpoint that does not answer", () => {
      expect(
        describeTxsError(new TypeError("Load failed"), {
          endpoint: devnet,
          cluster: "devnet",
        })
      ).toBe("Can't reach the RPC endpoint at https://api.devnet.solana.com.");
    });

    it("keeps the words of an endpoint that answered with an error", () => {
      expect(
        describeTxsError(new Error("429 Too Many Requests"), {
          endpoint: devnet,
          cluster: "devnet",
        })
      ).toBe("Connection error: 429 Too Many Requests");
    });

    it("names only the endpoint's origin, never its query", () => {
      expect(
        describeTxsError(new TypeError("Failed to fetch"), {
          endpoint: "https://devnet.helius-rpc.com/?api-key=secret",
          cluster: "devnet",
        })
      ).toBe("Can't reach the RPC endpoint at https://devnet.helius-rpc.com.");
    });

    it("keeps the words of a failure that is not an Error", () => {
      expect(
        describeTxsError(
          { message: "Wallet locked" },
          { endpoint: devnet, cluster: "devnet" }
        )
      ).toBe("Connection error: Wallet locked");
    });

    it("says unknown when the failure carries no words", () => {
      expect(
        describeTxsError(undefined, { endpoint: devnet, cluster: "devnet" })
      ).toBe("Connection error: Unknown error");
    });
  });
}
