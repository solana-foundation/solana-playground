import { Endpoint } from "../constants";
import type { Cluster } from "../utils";
import { PgBlockExplorer, PgConnection } from "../utils";

export const solanaFM = PgBlockExplorer.create({
  name: "Solana FM",
  url: "https://solana.fm",
  getClusterParam: (cluster: Cluster | null | undefined) => {
    // Omitted means the selected network; `null` is a network with no cluster
    switch (cluster === undefined ? PgConnection.cluster : cluster) {
      case "testnet":
        return "?cluster=testnet-solana";
      case "devnet":
        return "?cluster=devnet-solana";
      case "localnet":
        // Doesn't work with protocol ("http") prefix
        return "?cluster=custom-" + new URL(Endpoint.LOCALNET).host;
      default:
        return "";
    }
  },
});
