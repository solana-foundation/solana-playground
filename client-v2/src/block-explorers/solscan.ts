import { PgBlockExplorer, PgConnection } from "../utils";

export const solscan = PgBlockExplorer.create({
  name: "Solscan",
  url: "https://solscan.io",
  getClusterParam: (cluster = PgConnection.cluster) => {
    switch (cluster) {
      case "testnet":
        return "?cluster=testnet";
      case "devnet":
        return "?cluster=devnet";
      case "localnet":
        // No support https://solana.stackexchange.com/a/2330
        return "";
      default:
        return "";
    }
  },
});
