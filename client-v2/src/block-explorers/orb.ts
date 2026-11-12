import type { Cluster } from "../utils";
import { PgBlockExplorer, PgConnection } from "../utils";

export const orb = PgBlockExplorer.create({
  name: "Orb",
  url: "https://orbmarkets.io",
  getClusterParam: (cluster: Cluster | null | undefined) => {
    // Omitted means the selected network; `null` is a network with no cluster
    switch (cluster === undefined ? PgConnection.cluster : cluster) {
      case "testnet":
        return "?cluster=testnet";
      case "devnet":
        return "?cluster=devnet";
      default:
        // Orb reads only mainnet, devnet and testnet, each over its own RPC:
        // no local validator and no custom RPC URL
        return "";
    }
  },
});
