import { afterEach, describe, expect, it, vi } from "vitest";

import type { Network } from "../connection";
import { buildNetworks, clusterName, Endpoint } from "../connection";

describe("buildNetworks", () => {
  it("offers Devnet and Mainnet on the public URLs when nothing is configured", () => {
    expect(buildNetworks({})).toEqual([
      { name: "Devnet", value: Endpoint.DEVNET, cluster: "devnet" },
      {
        name: "Mainnet",
        value: Endpoint.MAINNET_BETA,
        cluster: "mainnet-beta",
      },
    ]);
  });

  // Sourcing an env file leaves unfilled keys as "", which is not nullish.
  it("treats an empty string as unset", () => {
    expect(
      buildNetworks({ devnet: "", mainnet: "" }).map((n) => n.value)
    ).toEqual([Endpoint.DEVNET, Endpoint.MAINNET_BETA]);
  });

  it("points each network at the platform URL the env configures", () => {
    expect(
      buildNetworks({
        mainnet: "https://mainnet.example.com",
        devnet: "https://devnet.example.com",
      })
    ).toEqual([
      {
        name: "Devnet",
        value: "https://devnet.example.com",
        cluster: "devnet",
      },
      {
        name: "Mainnet",
        value: "https://mainnet.example.com",
        cluster: "mainnet-beta",
      },
    ]);
  });
});

describe("clusterName", () => {
  it.each([
    ["devnet", "Devnet"],
    ["mainnet-beta", "Mainnet"],
    ["testnet", "Testnet"],
    ["localnet", "Localnet"],
    ["playnet", "Playnet"],
  ])("names %s as %s", (cluster, name) => {
    expect(clusterName(cluster)).toBe(name);
  });

  it("keeps an unknown cluster as it is", () => {
    expect(clusterName("unknown")).toBe("unknown");
  });

  it("returns undefined for no cluster", () => {
    // eslint-disable-next-line unicorn/no-null -- the cluster is `null` until read
    expect(clusterName(null)).toBeUndefined();
  });
});

// Guards the `process.env` var names, which nothing else would catch: a typo
// there just yields the public URLs.
describe("env wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads REACT_APP_DEVNET_RPC_URL and REACT_APP_MAINNET_RPC_URL", async () => {
    vi.stubEnv("REACT_APP_DEVNET_RPC_URL", "https://devnet.example.com");
    vi.stubEnv("REACT_APP_MAINNET_RPC_URL", "https://mainnet.example.com");

    vi.resetModules();
    const mod = await import("../connection");

    expect(mod.NETWORKS.map((n: Network) => n.value)).toEqual([
      "https://devnet.example.com",
      "https://mainnet.example.com",
    ]);
    expect(mod.DEFAULT_ENDPOINT).toBe("https://devnet.example.com");
  });

  it("falls back to the public URLs and the public devnet default when unset", async () => {
    vi.stubEnv("REACT_APP_DEVNET_RPC_URL", undefined);
    vi.stubEnv("REACT_APP_MAINNET_RPC_URL", undefined);

    vi.resetModules();
    const mod = await import("../connection");

    expect(mod.NETWORKS.map((n: Network) => n.value)).toEqual([
      Endpoint.DEVNET,
      Endpoint.MAINNET_BETA,
    ]);
    expect(mod.DEFAULT_ENDPOINT).toBe(Endpoint.DEVNET);
  });
});
