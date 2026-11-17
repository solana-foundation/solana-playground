import {
  bundlrStorage,
  Metaplex,
  walletAdapterIdentity,
} from "@metaplex-foundation/js";

import { getConnectionFor } from "@/entities/cluster";

import { PgConnection, PgSettings, PgWallet } from "../../../utils";
import { BundlrEnpoints } from "../constants";

export const getMetaplex = async (endpoint?: string) => {
  return Metaplex.make(
    getConnectionFor(undefined)(endpoint ?? PgSettings.connection.endpoint)
  )
    .use(walletAdapterIdentity(PgWallet.current!))
    .use(
      bundlrStorage({
        address:
          (await PgConnection.getCluster(endpoint)) === "mainnet"
            ? BundlrEnpoints.MAINNET
            : BundlrEnpoints.DEVNET,
        providerUrl: endpoint,
      })
    );
};
