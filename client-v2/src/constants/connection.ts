import { PLATFORM_RPC_URLS } from "../shared/config/client-env";

/** RPC endpoint */
export enum Endpoint {
  PLAYNET = "http://playnet",
  LOCALNET = "http://localhost:8899",
  /**
   * `surfpool start`'s RPC. Its port is Localnet's; the host tells the two
   * offered networks apart, and both resolve to the `localnet` cluster.
   */
  SURFPOOL = "http://127.0.0.1:8899",
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
 * telemetry keep. An unknown moniker comes back as it is, and no cluster
 * (`null`) has no name.
 */
export function clusterName(cluster: string): string;
export function clusterName(cluster: string | null): string | undefined;
export function clusterName(cluster: string | null): string | undefined {
  if (cluster === null) return undefined;
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
 * devnet SOL"), any other name as it is, `undefined` while the cluster
 * is unknown, so a caller can drop the word ("Not enough SOL") rather than
 * print "the network SOL". Standalone labels such as pickers and chips keep
 * `clusterName`.
 */
export const networkInSentence = (
  cluster: string | null | undefined
): string | undefined => {
  if (cluster === null || cluster === undefined) return undefined;
  const name = clusterName(cluster);
  const lower = name.toLowerCase();
  return LOWERCASE_IN_SENTENCE.has(lower) ? lower : name;
};

/**
 * The network's SOL in a sentence: "devnet SOL", or plain "SOL" while the
 * network (`networkInSentence`'s answer) is unknown
 */
export const solOn = (network: string | undefined): string =>
  network === undefined ? "SOL" : `${network} SOL`;

/** Cluster moniker an offered network talks to */
type NetworkCluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";

/** What an offered network is stored under: its cluster, or `surfpool` */
type NetworkKey = NetworkCluster | "surfpool";

/** A network Settings offers: one of ours, named as the cluster */
export interface Network {
  /**
   * What the network is stored under, unique among the networks: the
   * cluster, except Surfpool's, which shares Localnet's cluster
   */
  key: NetworkKey;
  name: string;
  value: string;
  cluster: NetworkCluster;
}

/** Configured platform RPC URLs, keyed by network */
interface PlatformRpcUrls {
  devnet?: string;
  mainnet?: string;
  testnet?: string;
}

/**
 * The networks Settings offers, in its order: Mainnet, Devnet and Testnet,
 * each on the platform RPC the env configures, else on the public one, then
 * Localnet and Surfpool on their local defaults. The public RPCs rate-limit a
 * shared app, so they are only the fallback, never listed beside ours.
 */
export const buildNetworks = (urls: PlatformRpcUrls): Network[] => [
  // `||` not `??`: sourcing an env file leaves unfilled keys as "", which
  // is not nullish and would win.
  ...(
    [
      [urls.mainnet || Endpoint.MAINNET_BETA, "mainnet-beta"],
      [urls.devnet || Endpoint.DEVNET, "devnet"],
      [urls.testnet || Endpoint.TESTNET, "testnet"],
      [Endpoint.LOCALNET, "localnet"],
    ] as const
  ).map(([value, cluster]) => ({
    key: cluster,
    name: clusterName(cluster),
    value,
    cluster,
  })),
  {
    key: "surfpool",
    name: "Surfpool",
    value: Endpoint.SURFPOOL,
    cluster: "localnet",
  },
];

/** The networks Settings offers, Mainnet first; Devnet is the default */
export const NETWORKS = buildNetworks(PLATFORM_RPC_URLS);

/** Default RPC endpoint: the offered Devnet */
const OFFERED_DEVNET = NETWORKS.find((n) => n.cluster === "devnet");
if (!OFFERED_DEVNET) throw new Error("The offered networks have no Devnet");
export const DEFAULT_ENDPOINT = OFFERED_DEVNET.value;

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
      expect(networkInSentence(undefined)).toBeUndefined();
    });

    it("networkInSentence lowercases every cluster that has a name", () => {
      for (const [cluster, name] of Object.entries(CLUSTER_NAMES)) {
        expect(networkInSentence(cluster)).toBe(name.toLowerCase());
      }
    });

    it("solOn names the network's SOL, or plain SOL while it is unknown", () => {
      expect(solOn("devnet")).toBe("devnet SOL");
      expect(solOn(undefined)).toBe("SOL");
    });

    it("UNKNOWN_NETWORK is what prose says while the cluster is unknown", () => {
      expect(UNKNOWN_NETWORK).toBe("the network");
    });
  });
}
