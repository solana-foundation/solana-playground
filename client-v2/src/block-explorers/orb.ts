import type { Cluster } from "../utils";
import { PgBlockExplorer, PgConnection } from "../utils";

const URL = "https://orbmarkets.io";

const getClusterParam = (cluster: Cluster | null | undefined) => {
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
};

export const orb = PgBlockExplorer.create({
  name: "Orb",
  url: URL,
  getClusterParam,
  // Orb names its IDL tab `anchor-idl`
  // eslint-disable-next-line layers/curry-order -- the explorer interface's shape: id first, network optional
  getIdlUrl: (programId: string, cluster?: Cluster | null) =>
    `${URL}/address/${programId}/anchor-idl${getClusterParam(cluster)}`,
});
