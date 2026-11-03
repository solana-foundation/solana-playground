import { PLATFORM_RPC_URLS } from "../shared/config/client-env";

/** RPC endpoint */
export enum Endpoint {
  PLAYNET = "http://playnet",
  LOCALNET = "http://localhost:8899",
  DEVNET = "https://api.devnet.solana.com",
  TESTNET = "https://api.testnet.solana.com",
  MAINNET_BETA = "https://api.mainnet-beta.solana.com",
}

const CLUSTER_NAMES: Record<string, string> = {
  devnet: "Devnet",
  "mainnet-beta": "Mainnet",
  testnet: "Testnet",
  localnet: "Localnet",
  playnet: "Playnet",
};

/**
 * A cluster's name as a person reads it: a proper noun, so capitalised, and
 * "Mainnet" for the `mainnet-beta` moniker, which URLs, CLI flags and
 * telemetry keep. An unknown moniker comes back as it is.
 */
export function clusterName(cluster: string): string;
export function clusterName(cluster: string | null): string | null;
export function clusterName(cluster: string | null): string | null {
  if (cluster === null) return null;
  return Object.hasOwn(CLUSTER_NAMES, cluster)
    ? CLUSTER_NAMES[cluster]
    : cluster;
}

/** Our clusters, written lowercase mid-sentence: "Deploy to devnet" */
const LOWERCASE_IN_SENTENCE = new Set(
  Object.values(CLUSTER_NAMES).map((name) => name.toLowerCase())
);

/** What prose calls the network while the cluster is unknown */
export const UNKNOWN_NETWORK = "the network";

/**
 * The network as a sentence names it: our clusters lowercase ("Not enough
 * devnet SOL"), any other name (Surfpool) as it is, `null` while the cluster
 * is unknown, so a caller can drop the word ("Not enough SOL") rather than
 * print "the network SOL". Standalone labels such as pickers and chips keep
 * `networkName`.
 */
export const networkInSentence = (cluster: string | null): string | null => {
  const name = clusterName(cluster);
  if (name === null) return null;
  const lower = name.toLowerCase();
  return LOWERCASE_IN_SENTENCE.has(lower) ? lower : name;
};

/**
 * The network's SOL in a sentence: "devnet SOL", or plain "SOL" while the
 * network (`networkInSentence`'s answer) is unknown
 */
export const solOn = (network: string | null): string =>
  network === null ? "SOL" : `${network} SOL`;

/** Cluster moniker an offered network talks to */
type NetworkCluster = "devnet" | "mainnet-beta";

/** A network Settings offers: one of ours, named as the cluster */
export interface Network {
  name: string;
  value: string;
  cluster: NetworkCluster;
}

/** Configured platform RPC URLs, keyed by network */
interface PlatformRpcUrls {
  devnet?: string;
  mainnet?: string;
}

/**
 * The networks Settings offers: Devnet and Mainnet, each on the platform RPC
 * the env configures, else on the public one. The public RPCs rate-limit a
 * shared app, so they are only the fallback, never listed beside ours.
 */
export const buildNetworks = (urls: PlatformRpcUrls): Network[] =>
  (
    [
      // `||` not `??`: sourcing an env file leaves unfilled keys as "", which
      // is not nullish and would win.
      [urls.devnet || Endpoint.DEVNET, "devnet"],
      [urls.mainnet || Endpoint.MAINNET_BETA, "mainnet-beta"],
    ] as const
  ).map(([value, cluster]) => ({ name: clusterName(cluster), value, cluster }));

/** The networks Settings offers, Devnet first */
export const NETWORKS = buildNetworks(PLATFORM_RPC_URLS);

/** Default RPC endpoint: the offered Devnet */
export const DEFAULT_ENDPOINT = NETWORKS.find(
  (n) => n.cluster === "devnet"
)!.value;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("constants/connection", () => {
    it("networkInSentence lowercases the cluster mid-sentence, other names as they are", () => {
      expect(networkInSentence("devnet")).toBe("devnet");
      expect(networkInSentence("mainnet-beta")).toBe("mainnet");
      expect(networkInSentence("testnet")).toBe("testnet");
      expect(networkInSentence("localnet")).toBe("localnet");
      expect(networkInSentence("playnet")).toBe("playnet");
      expect(networkInSentence("Surfpool")).toBe("Surfpool");
      expect(networkInSentence(null)).toBeNull();
    });

    it("networkInSentence lowercases every cluster that has a name", () => {
      for (const [cluster, name] of Object.entries(CLUSTER_NAMES)) {
        expect(networkInSentence(cluster)).toBe(name.toLowerCase());
      }
    });

    it("solOn names the network's SOL, or plain SOL while it is unknown", () => {
      expect(solOn("devnet")).toBe("devnet SOL");
      expect(solOn(null)).toBe("SOL");
    });

    it("UNKNOWN_NETWORK is what prose says while the cluster is unknown", () => {
      expect(UNKNOWN_NETWORK).toBe("the network");
    });
  });
}
