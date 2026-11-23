import { describe, expect, it } from "vitest";

import { Endpoint } from "@/entities/cluster";

import { TerminalLineError } from "../../utils/terminal/line-error";
import { normalizeToUrlIfMoniker } from "./url";

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
