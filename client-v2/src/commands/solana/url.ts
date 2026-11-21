import { Endpoint } from "@/entities/cluster";

/** The public RPC URL each cluster moniker stands for, as `solana -u` takes them */
const MONIKERS: Record<string, string> = {
  m: Endpoint.MAINNET,
  "mainnet-beta": Endpoint.MAINNET,
  t: Endpoint.TESTNET,
  testnet: Endpoint.TESTNET,
  d: Endpoint.DEVNET,
  devnet: Endpoint.DEVNET,
  l: Endpoint.LOCALNET,
  localhost: Endpoint.LOCALNET,
};

/**
 * The URL `-u` names: the public RPC URL of a cluster moniker (`m`/`mainnet-beta`,
 * `t`/`testnet`, `d`/`devnet`, `l`/`localhost`), and any other value as given.
 *
 * @param urlOrMoniker the value of `-u`
 * @returns the RPC URL
 */
export const normalizeToUrlIfMoniker = (urlOrMoniker: string) =>
  Object.hasOwn(MONIKERS, urlOrMoniker) ? MONIKERS[urlOrMoniker] : urlOrMoniker;

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("commands/solana/url", () => {
    it.each([
      ["m", Endpoint.MAINNET],
      ["mainnet-beta", Endpoint.MAINNET],
      ["t", Endpoint.TESTNET],
      ["testnet", Endpoint.TESTNET],
      ["d", Endpoint.DEVNET],
      ["devnet", Endpoint.DEVNET],
      ["l", Endpoint.LOCALNET],
      ["localhost", Endpoint.LOCALNET],
    ])("resolves the moniker %s to %s", (moniker, url) => {
      expect(normalizeToUrlIfMoniker(moniker)).toBe(url);
    });

    it("keeps a URL as given", () => {
      const url = "https://devnet.helius-rpc.com/?api-key=k";

      expect(normalizeToUrlIfMoniker(url)).toBe(url);
    });

    it("keeps a value that is not a moniker, however it looks", () => {
      expect(normalizeToUrlIfMoniker("toString")).toBe("toString");
      expect(normalizeToUrlIfMoniker("D")).toBe("D");
    });
  });
}
