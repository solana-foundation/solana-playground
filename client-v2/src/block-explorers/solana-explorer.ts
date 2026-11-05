import { Endpoint } from "../constants";
import type { Cluster } from "../utils";
import { PgBlockExplorer, PgConnection } from "../utils";

export const solanaExplorer = PgBlockExplorer.create({
  name: "Solana Explorer",
  url: "https://explorer.solana.com",
  getClusterParam: (cluster: Cluster | null | undefined) => {
    // Omitted means the selected network; `null` is a network with no cluster
    switch (cluster === undefined ? PgConnection.cluster : cluster) {
      case "testnet":
        return "?cluster=testnet";
      case "devnet":
        return "?cluster=devnet";
      case "localnet":
        return "?cluster=custom&customUrl=" + Endpoint.LOCALNET;
      default:
        return "";
    }
  },
});
