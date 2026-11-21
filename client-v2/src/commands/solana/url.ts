import { Endpoint } from "@/entities/cluster";

import { TerminalLineError } from "../../utils/terminal/line-error";

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

/** Whether a value is an http(s) URL with a host, which the browser can send a request to; anything else it resolves against the app's own origin */
const isHttpUrl = (value: string) => /^https?:\/\/[^\s/?#]+\S*$/i.test(value);

/**
 * The URL `-u` names: the public RPC URL of a cluster moniker (`m`/`mainnet-beta`,
 * `t`/`testnet`, `d`/`devnet`, `l`/`localhost`), and an http(s) URL as given.
 *
 * @param urlOrMoniker the value of `-u`
 * @returns the RPC URL
 * @throws {TerminalLineError} when the value is neither a moniker nor an http(s) URL
 */
export const normalizeToUrlIfMoniker = (urlOrMoniker: string) => {
  if (Object.hasOwn(MONIKERS, urlOrMoniker)) return MONIKERS[urlOrMoniker];
  if (isHttpUrl(urlOrMoniker)) return urlOrMoniker;

  throw new TerminalLineError(
    `Invalid RPC URL or cluster: \`${urlOrMoniker}\`. Use a moniker (m, t, d, l, mainnet-beta, testnet, devnet, localhost) or an http(s) URL.`
  );
};

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

    it.each(["toString", "D", "dev", "wss://example.com", "example.com", ""])(
      "refuses %j, naming the accepted forms",
      (value) => {
        expect(() => normalizeToUrlIfMoniker(value)).toThrow(TerminalLineError);
        expect(() => normalizeToUrlIfMoniker(value)).toThrow(
          /moniker .* or an http\(s\) URL/
        );
      }
    );
  });
}
