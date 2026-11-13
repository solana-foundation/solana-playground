// The model file, not the slice's entry: `settings/stored-endpoint.ts` loads this before everything else
import type {
  Cluster,
  ClusterKey,
  Clusters,
} from "../entities/cluster/model/clusters";
import {
  clusterName,
  CLUSTERS,
  offeredOf,
} from "../entities/cluster/model/clusters";

export { clusterName, Endpoint } from "../entities/cluster/model/clusters";

/** Our clusters, written lowercase mid-sentence: "Deploy to devnet" */
const LOWERCASE_IN_SENTENCE = new Set(
  Object.values(CLUSTERS)
    .filter((c) => c.key === c.cluster)
    .map(({ name }) => name.toLowerCase())
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

/** A network Settings offers: one of ours, named as the cluster */
export interface Network {
  /**
   * What the network is stored under, unique among the networks: the
   * cluster, except Surfpool's, which shares Localnet's cluster
   */
  key: ClusterKey;
  name: string;
  value: string;
  cluster: Cluster;
}

/** The networks Settings offers, in its order, from the cluster table */
export const networksOf = (clusters: Clusters): Network[] =>
  offeredOf(clusters).map(({ key, name, url, cluster }) => ({
    key,
    name,
    value: url,
    cluster,
  }));

/** The networks Settings offers, Mainnet first; Devnet is the default */
export const NETWORKS = networksOf(CLUSTERS);

/** Default RPC endpoint: the offered Devnet */
export const DEFAULT_ENDPOINT = CLUSTERS.devnet.url;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("constants/connection", () => {
    it("networkInSentence lowercases the cluster mid-sentence, other names as they are", () => {
      expect(networkInSentence("devnet")).toBe("devnet");
      expect(networkInSentence("mainnet")).toBe("mainnet");
      expect(networkInSentence("testnet")).toBe("testnet");
      expect(networkInSentence("localnet")).toBe("localnet");
      expect(networkInSentence("playnet")).toBe("playnet");
      expect(networkInSentence("Surfpool")).toBe("Surfpool");
      expect(networkInSentence(undefined)).toBeUndefined();
    });

    it("networkInSentence lowercases every cluster that has a name", () => {
      for (const { key, cluster, name } of Object.values(CLUSTERS)) {
        if (key !== cluster) continue;
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
