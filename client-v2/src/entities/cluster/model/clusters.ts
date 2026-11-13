// Imports nothing but `client-env` and `endpoint`: `settings/stored-endpoint.ts`, which loads before everything else, reads this file
import {
  NATIVE_RPC_URLS,
  PLATFORM_RPC_URLS,
  SEND_TX_PER_SECOND,
} from "@/shared/config/client-env";

import { Endpoint } from "./endpoint";

export { Endpoint };

/** Solana public clusters, "localnet" or "playnet" */
export type Cluster = "devnet" | "testnet" | "mainnet" | "localnet" | "playnet";

/**
 * What a connection endpoint of ours is stored under: its cluster, or
 * `surfpool`, which shares Localnet's cluster but is a chip of its own
 */
export type ClusterKey = Cluster | "surfpool";

/** The clusters the env configures */
type EnvCluster = "devnet" | "testnet" | "mainnet";

/** What the env sets for one cluster, spelled as `client-env` reads it */
interface ClusterEnv {
  rpcUrl?: string;
  nativeRpcUrl?: string;
  sendTxPerSecond?: string;
}

/** One endpoint of ours: its key, the cluster it talks to, its names, its URLs and the limits the env sets on it */
export interface ClusterInfo {
  key: ClusterKey;
  cluster: Cluster;
  /** A proper noun: "Mainnet" for `mainnet` */
  name: string;
  publicUrl: string;
  /** What a connection uses: the platform RPC the env sets, else `publicUrl` */
  url: string;
  /** Whether Settings offers it as a network chip */
  isOffered: boolean;
  /** The cluster's native RPC, which airdrops and buffer reads go through; `undefined` uses the selected endpoint */
  nativeRpcUrl: string | undefined;
  /** The most `sendTransaction` calls per second a deploy sends; `undefined` caps nothing */
  sendTxPerSecond: number | undefined;
}

export type Clusters = Readonly<Record<ClusterKey, ClusterInfo>>;

/** An env cluster's send cap when the env sets no positive one, below Helius Developer's `sendTransaction` limit (https://www.helius.dev/docs/billing/rate-limits) */
const DEFAULT_SEND_TX_PER_SECOND = 4;

/** A positive number, else `undefined`: the env leaves a cap unset, empty or unparsable */
const perSecondOf = (value: string | undefined) => {
  const perSecond = Number(value);
  return Number.isFinite(perSecond) && perSecond > 0 ? perSecond : undefined;
};

/** One of our endpoints with no send cap: Localnet, Surfpool and Playnet run on the person's machine or in the browser */
const infoOf = (
  [key, cluster, name, publicUrl, isOffered]: readonly [
    ClusterKey,
    Cluster,
    string,
    Endpoint,
    boolean
  ],
  env: ClusterEnv
): ClusterInfo => ({
  key,
  cluster,
  name,
  publicUrl,
  // `||` not `??`: sourcing an env file leaves unfilled keys as "", which is not nullish and would win
  url: env.rpcUrl || publicUrl,
  isOffered,
  nativeRpcUrl: env.nativeRpcUrl || undefined,
  sendTxPerSecond: undefined,
});

/** An env cluster's endpoint, capped at the env's send cap or {@link DEFAULT_SEND_TX_PER_SECOND} */
const envInfoOf = (
  meta: Parameters<typeof infoOf>[0],
  env: ClusterEnv
): ClusterInfo => ({
  ...infoOf(meta, env),
  sendTxPerSecond:
    perSecondOf(env.sendTxPerSecond) ?? DEFAULT_SEND_TX_PER_SECOND,
});

/**
 * Every endpoint of ours on what `env` sets, in the order Settings offers the
 * chips: Mainnet, Devnet, Testnet, Localnet, Surfpool. The public RPCs
 * rate-limit a shared app, so they are only the fallback of a platform one,
 * never offered beside it. Playnet is not offered; code paths set it.
 */
export const clustersFor = (
  env: Partial<Record<EnvCluster, ClusterEnv>>
): Clusters => ({
  mainnet: envInfoOf(
    ["mainnet", "mainnet", "Mainnet", Endpoint.MAINNET, true],
    env.mainnet ?? {}
  ),
  devnet: envInfoOf(
    ["devnet", "devnet", "Devnet", Endpoint.DEVNET, true],
    env.devnet ?? {}
  ),
  testnet: envInfoOf(
    ["testnet", "testnet", "Testnet", Endpoint.TESTNET, true],
    env.testnet ?? {}
  ),
  localnet: infoOf(
    ["localnet", "localnet", "Localnet", Endpoint.LOCALNET, true],
    {}
  ),
  surfpool: infoOf(
    ["surfpool", "localnet", "Surfpool", Endpoint.SURFPOOL, true],
    {}
  ),
  playnet: infoOf(
    ["playnet", "playnet", "Playnet", Endpoint.PLAYNET, false],
    {}
  ),
});

const envOf = (cluster: EnvCluster): ClusterEnv => ({
  rpcUrl: PLATFORM_RPC_URLS[cluster],
  nativeRpcUrl: NATIVE_RPC_URLS[cluster],
  sendTxPerSecond: SEND_TX_PER_SECOND[cluster],
});

/** Every endpoint of ours on what this build's env sets */
export const CLUSTERS = clustersFor({
  devnet: envOf("devnet"),
  testnet: envOf("testnet"),
  mainnet: envOf("mainnet"),
});

/** The network chips Settings offers, in its order */
export const offeredOf = (clusters: Clusters): ReadonlyArray<ClusterInfo> =>
  Object.values(clusters).filter((c) => c.isOffered);

const MONIKERS: ReadonlySet<string> = new Set<Cluster>([
  "devnet",
  "testnet",
  "mainnet",
  "localnet",
  "playnet",
]);

/** Whether `value` is one of our clusters' monikers; `surfpool` is a key, not a cluster */
export const isCluster = (value: string): value is Cluster =>
  MONIKERS.has(value);

/** Monikers a stored record may hold from before a cluster was renamed, under the current one */
const RENAMED_MONIKERS: Readonly<Record<string, Cluster>> = {
  "mainnet-beta": "mainnet",
};

/** A moniker read from storage under its current name: Solana renamed `mainnet-beta` to `mainnet` */
export const currentMonikerOf = (moniker: string): string =>
  Object.hasOwn(RENAMED_MONIKERS, moniker)
    ? RENAMED_MONIKERS[moniker]
    : moniker;

/** The stored keys a renamed cluster's {@link ClusterSelection} may still hold */
export const renamedKeysOf = (key: ClusterKey): ReadonlyArray<string> =>
  Object.keys(RENAMED_MONIKERS).filter((old) => RENAMED_MONIKERS[old] === key);

/**
 * A cluster's name as a person reads it. An unknown moniker comes back as it
 * is, and no cluster (`null`) has no name.
 */
export function clusterName(cluster: string): string;
export function clusterName(cluster: string | null): string | undefined;
export function clusterName(cluster: string | null): string | undefined {
  if (cluster === null) return undefined;
  return isCluster(cluster) ? CLUSTERS[cluster].name : cluster;
}

/**
 * A connection endpoint as the settings store it: one of ours by its key, or
 * a custom RPC. Only the custom arm carries a URL, so a platform URL, API key
 * included, is never stored.
 */
export type ClusterSelection =
  | { key: ClusterKey }
  | { cluster: "custom"; url: string };

const withSlash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

/**
 * The cluster whose `url` or `publicUrl` `endpoint` is, known without a
 * request; `undefined` for any other endpoint. The public URL matches with or
 * without a trailing slash, as web3.js spells Mainnet's with one.
 */
export const findClusterWith =
  (clusters: Clusters) =>
  (endpoint: string): Cluster | undefined =>
    Object.values(clusters).find(
      (c) =>
        c.url === endpoint || withSlash(c.publicUrl) === withSlash(endpoint)
    )?.cluster;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("entities/cluster/model/clusters", () => {
    const offered = (clusters: Clusters) =>
      offeredOf(clusters).map((c) => [c.key, c.url]);

    it("offers Mainnet, Devnet, Testnet, Localnet and Surfpool, the remote ones on the public URLs when nothing is configured", () => {
      expect(offered(clustersFor({}))).toEqual([
        ["mainnet", Endpoint.MAINNET],
        ["devnet", Endpoint.DEVNET],
        ["testnet", Endpoint.TESTNET],
        ["localnet", Endpoint.LOCALNET],
        ["surfpool", Endpoint.SURFPOOL],
      ]);
    });

    it.each([
      // eslint-disable-next-line no-restricted-syntax -- the value under test
      [Endpoint.DEVNET, "https://api.devnet.solana.com"],
      // eslint-disable-next-line no-restricted-syntax -- the value under test
      [Endpoint.TESTNET, "https://api.testnet.solana.com"],
      // eslint-disable-next-line no-restricted-syntax -- the value under test
      [Endpoint.MAINNET, "https://api.mainnet-beta.solana.com"],
    ])("holds the public RPC %s", (endpoint, url) => {
      expect(endpoint).toBe(url);
    });

    it("treats an empty string as unset", () => {
      const clusters = clustersFor({
        devnet: { rpcUrl: "", nativeRpcUrl: "" },
        testnet: { rpcUrl: "" },
      });

      expect(clusters.devnet.url).toBe(Endpoint.DEVNET);
      expect(clusters.devnet.nativeRpcUrl).toBeUndefined();
      expect(clusters.testnet.url).toBe(Endpoint.TESTNET);
    });

    it("points each remote chip at the platform URL the env configures", () => {
      const clusters = clustersFor({
        devnet: { rpcUrl: "https://devnet.example.com" },
        mainnet: { rpcUrl: "https://mainnet.example.com" },
        testnet: { rpcUrl: "https://testnet.example.com" },
      });

      expect(offered(clusters).slice(0, 3)).toEqual([
        ["mainnet", "https://mainnet.example.com"],
        ["devnet", "https://devnet.example.com"],
        ["testnet", "https://testnet.example.com"],
      ]);
    });

    it("keeps Surfpool on Localnet's cluster under a key of its own", () => {
      expect(CLUSTERS.surfpool).toMatchObject({
        key: "surfpool",
        cluster: "localnet",
        name: "Surfpool",
      });
      expect(isCluster("surfpool")).toBe(false);
    });

    it.each([
      ["devnet", "Devnet"],
      ["mainnet", "Mainnet"],
      ["testnet", "Testnet"],
      ["localnet", "Localnet"],
      ["playnet", "Playnet"],
      ["unknown", "unknown"],
      ["Surfpool", "Surfpool"],
    ])("names %s as %s", (cluster, name) => {
      expect(clusterName(cluster)).toBe(name);
    });

    it("returns undefined for no cluster", () => {
      // eslint-disable-next-line unicorn/no-null -- the cluster is `null` until read
      expect(clusterName(null)).toBeUndefined();
    });

    it("names no cluster for an inherited property name", () => {
      expect(clusterName("toString")).toBe("toString");
    });

    it.each([
      ["mainnet-beta", "mainnet"],
      ["toString", "toString"],
    ])("reads the stored moniker %s as %s", (stored, current) => {
      expect(currentMonikerOf(stored)).toBe(current);
    });

    describe("findClusterWith", () => {
      const findCluster = findClusterWith(
        clustersFor({ devnet: { rpcUrl: "https://devnet.rpc.test/?k=1" } })
      );

      it.each([
        {
          label: "the platform URL",
          endpoint: "https://devnet.rpc.test/?k=1",
          cluster: "devnet",
        },
        {
          label: "the public URL a platform RPC replaces",
          endpoint: Endpoint.DEVNET,
          cluster: "devnet",
        },
        {
          label: "a public URL with a trailing slash",
          endpoint: `${Endpoint.MAINNET}/`,
          cluster: "mainnet",
        },
        {
          label: "Surfpool's URL",
          endpoint: Endpoint.SURFPOOL,
          cluster: "localnet",
        },
        { label: "a custom URL", endpoint: "https://custom.test" },
      ])("finds the cluster of $label", ({ endpoint, cluster }) => {
        expect(findCluster(endpoint)).toBe(cluster);
      });
    });
  });
}
