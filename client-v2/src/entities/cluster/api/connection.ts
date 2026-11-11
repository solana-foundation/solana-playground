import type { Commitment, ConnectionConfig } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";

import type { Cluster } from "../model/clusters";
import { CLUSTERS } from "../model/clusters";

/** Bounds the cache, so custom endpoints cannot grow it without limit */
export const MAX_CACHED_CONNECTIONS = 25;

const connectionWith = (config: ConnectionConfig) => (endpoint: string) => {
  const connection = new Connection(endpoint, config);
  // A failed websocket otherwise reconnects forever, and removing its listeners does not stop it
  // @ts-expect-error -- web3.js keeps the websocket private
  connection._rpcWebSocket.reconnect = false;
  return connection;
};

const connections = new Map<string, Connection>();

const cachedWith = (key: string) => (build: () => Connection) => {
  const cached = connections.get(key);
  if (cached) return cached;

  const connection = build();
  if (connections.size >= MAX_CACHED_CONNECTIONS) {
    // A Map iterates in insertion order, so this drops the oldest
    const [oldest] = connections.keys();
    connections.delete(oldest);
  }
  connections.set(key, connection);
  return connection;
};

/**
 * The connection to `endpoint` at `commitment`, one per pair, shared by every
 * caller; `undefined` leaves the commitment to the RPC.
 */
export const getConnectionFor =
  (commitment: Commitment | undefined) => (endpoint: string) =>
    cachedWith(JSON.stringify(["default", commitment, endpoint]))(() =>
      connectionWith({ commitment })(endpoint)
    );

/** As {@link getConnectionFor}, on which web3.js does not retry a 429 itself */
export const getUnretriedConnectionFor =
  (commitment: Commitment | undefined) => (endpoint: string) =>
    cachedWith(JSON.stringify(["unretried", commitment, endpoint]))(() =>
      connectionWith({ commitment, disableRetryOnRateLimit: true })(endpoint)
    );

/**
 * A new connection to `endpoint` that sends through `fetch`, never cached:
 * its owner overrides its methods.
 */
export const buildConnectionWith =
  (fetch: NonNullable<ConnectionConfig["fetch"]>) => (endpoint: string) =>
    connectionWith({ fetch })(endpoint);

/**
 * The native RPC of `cluster` at `connection`'s commitment, else `connection`
 * itself: airdrops and program buffer reads go through it.
 */
export const getNativeConnectionFor =
  (cluster: Cluster | undefined) => (connection: Connection) => {
    const url = cluster && CLUSTERS[cluster].nativeRpcUrl;
    if (!url) return connection;
    return getConnectionFor(connection.commitment)(url);
  };

const CLUSTER_BY_GENESIS_HASH = new Map<string, Cluster>([
  ["EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "devnet"],
  ["4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY", "testnet"],
  ["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "mainnet-beta"],
]);

/** The public cluster `endpoint` serves, read from its genesis hash; throws for any other */
export const fetchClusterByGenesisHash = async (
  endpoint: string
): Promise<Cluster> => {
  const genesisHash = await getConnectionFor(undefined)(
    endpoint
  ).getGenesisHash();
  const cluster = CLUSTER_BY_GENESIS_HASH.get(genesisHash);
  if (!cluster) {
    throw new Error(`Genesis hash ${genesisHash} did not match any cluster`);
  }
  return cluster;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("entities/cluster/api/connection", () => {
    it("shares one connection per endpoint and commitment", () => {
      const a = getConnectionFor("confirmed")("https://a.test");

      expect(getConnectionFor("confirmed")("https://a.test")).toBe(a);
      expect(getConnectionFor("finalized")("https://a.test")).not.toBe(a);
      expect(getUnretriedConnectionFor("confirmed")("https://a.test")).not.toBe(
        a
      );
    });

    it("drops the oldest connection past the bound", () => {
      const first = getConnectionFor("processed")("https://first.test");
      for (let i = 0; i < MAX_CACHED_CONNECTIONS; i++) {
        getConnectionFor("processed")(`https://bound-${i}.test`);
      }

      expect(getConnectionFor("processed")("https://first.test")).not.toBe(
        first
      );
    });

    it("builds a new connection on every call with a fetch of its own", () => {
      const build = buildConnectionWith(fetch);

      expect(build("http://playnet")).not.toBe(build("http://playnet"));
    });
  });
}
