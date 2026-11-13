// No runtime import and no in-source test: Playwright compiles the e2e specs' import of it as CommonJS, where `import.meta` is a syntax error
import type { Cluster } from "./clusters";

/** The clusters whose RPCs answer `getGenesisHash` with a fixed hash */
type PublicCluster = Extract<Cluster, "devnet" | "testnet" | "mainnet-beta">;

/** What a public cluster's RPC answers to `getGenesisHash`, which names the cluster of an endpoint that is none of ours */
export const GENESIS_HASHES: Readonly<Record<PublicCluster, string>> = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};
