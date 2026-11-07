import { afterEach, describe, expect, it, vi } from "vitest";

import type { Network } from "../connection";
import { buildNetworks, clusterName, Endpoint } from "../connection";

/** The five networks, the remote ones on the given URLs, in Settings' order */
const offered = (urls: {
  mainnet: string;
  devnet: string;
  testnet: string;
}) => [
  {
    key: "mainnet-beta",
    name: "Mainnet",
    value: urls.mainnet,
    cluster: "mainnet-beta",
  },
  { key: "devnet", name: "Devnet", value: urls.devnet, cluster: "devnet" },
  { key: "testnet", name: "Testnet", value: urls.testnet, cluster: "testnet" },
  {
    key: "localnet",
    name: "Localnet",
    value: Endpoint.LOCALNET,
    cluster: "localnet",
  },
  {
    key: "surfpool",
    name: "Surfpool",
    value: Endpoint.SURFPOOL,
    cluster: "localnet",
  },
];

describe("buildNetworks", () => {
  it("offers Mainnet, Devnet, Testnet, Localnet and Surfpool, the remote ones on the public URLs when nothing is configured", () => {
    expect(buildNetworks({})).toEqual(
      offered({
        mainnet: Endpoint.MAINNET_BETA,
        devnet: Endpoint.DEVNET,
        testnet: Endpoint.TESTNET,
      })
    );
  });

  // Sourcing an env file leaves unfilled keys as "", which is not nullish.
  it("treats an empty string as unset", () => {
    expect(
      buildNetworks({ devnet: "", mainnet: "", testnet: "" }).map(
        (n) => n.value
      )
    ).toEqual([
      Endpoint.MAINNET_BETA,
      Endpoint.DEVNET,
      Endpoint.TESTNET,
      Endpoint.LOCALNET,
      Endpoint.SURFPOOL,
    ]);
  });

  it("points each remote network at the platform URL the env configures", () => {
    expect(
      buildNetworks({
        mainnet: "https://mainnet.example.com",
        devnet: "https://devnet.example.com",
        testnet: "https://testnet.example.com",
      })
    ).toEqual(
      offered({
        mainnet: "https://mainnet.example.com",
        devnet: "https://devnet.example.com",
        testnet: "https://testnet.example.com",
      })
    );
  });

  it("gives every network a key of its own and a URL of its own", () => {
    const networks = buildNetworks({});
    expect(new Set(networks.map((n) => n.key)).size).toBe(networks.length);
    expect(new Set(networks.map((n) => n.value)).size).toBe(networks.length);
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

  it("reads REACT_APP_DEVNET_RPC_URL, REACT_APP_MAINNET_RPC_URL and REACT_APP_TESTNET_RPC_URL", async () => {
    vi.stubEnv("REACT_APP_DEVNET_RPC_URL", "https://devnet.example.com");
    vi.stubEnv("REACT_APP_MAINNET_RPC_URL", "https://mainnet.example.com");
    vi.stubEnv("REACT_APP_TESTNET_RPC_URL", "https://testnet.example.com");

    vi.resetModules();
    const mod = await import("../connection");

    expect(mod.NETWORKS.map((n: Network) => n.value)).toEqual([
      "https://mainnet.example.com",
      "https://devnet.example.com",
      "https://testnet.example.com",
      Endpoint.LOCALNET,
      Endpoint.SURFPOOL,
    ]);
    expect(mod.DEFAULT_ENDPOINT).toBe("https://devnet.example.com");
  });

  it("falls back to the public URLs and the public devnet default when unset", async () => {
    vi.stubEnv("REACT_APP_DEVNET_RPC_URL", undefined);
    vi.stubEnv("REACT_APP_MAINNET_RPC_URL", undefined);
    vi.stubEnv("REACT_APP_TESTNET_RPC_URL", undefined);

    vi.resetModules();
    const mod = await import("../connection");

    expect(mod.NETWORKS.map((n: Network) => n.value)).toEqual([
      Endpoint.MAINNET_BETA,
      Endpoint.DEVNET,
      Endpoint.TESTNET,
      Endpoint.LOCALNET,
      Endpoint.SURFPOOL,
    ]);
    expect(mod.DEFAULT_ENDPOINT).toBe(Endpoint.DEVNET);
  });
});
