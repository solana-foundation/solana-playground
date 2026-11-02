import { FC, useEffect } from "react";

import {
  watchExternalWallets,
  type SigningCluster,
} from "@/entities/external-wallet";
import { PgConnection, PgWallet } from "../../utils";
import { useWallet } from "../../hooks";

/** ConnectorKit's cluster ids by the Playground's; the rest sign without a hint */
const SIGNING_CLUSTER_IDS: Partial<Record<string, SigningCluster["id"]>> = {
  "mainnet-beta": "solana:mainnet",
  devnet: "solana:devnet",
  testnet: "solana:testnet",
};

/** The chain an external wallet is told it signs for: the Playground's cluster */
const signingCluster = (): SigningCluster | undefined => {
  const name = PgConnection.cluster;
  if (!name) return undefined;
  const id = SIGNING_CLUSTER_IDS[name];
  if (!id) return undefined;
  return { id, label: name, url: PgConnection.current.rpcEndpoint };
};

export const SolanaProvider: FC<React.PropsWithChildren<unknown>> = ({
  children,
}) => {
  const wallet = useWallet();

  // Set the standard wallets, found through ConnectorKit's registry
  useEffect(
    () =>
      watchExternalWallets(
        (wallets) => {
          PgWallet.standardWallets = wallets;
        },
        { signingCluster }
      ),
    []
  );

  // Sync values when the user changes standard wallet accounts in the extension
  useEffect(() => {
    if (!wallet || wallet.isPg) return;

    const handleStandardAccountChange = () => {
      // Set the `standardWallets` to itself to trigger the re-derivation of the
      // derivable fields that depend on this field.
      //
      // NOTE: Cloning into a new array is required to bypass caching.
      PgWallet.standardWallets = [...PgWallet.standardWallets];
    };

    // There is no specific event for account changes; the bridge fires
    // `connect` after an account switch, as wallet-adapter did, and
    // `disconnect` when the user revokes the site inside the extension
    wallet.on("connect", handleStandardAccountChange);
    wallet.on("disconnect", handleStandardAccountChange);

    return () => {
      wallet.off("connect", handleStandardAccountChange);
      wallet.off("disconnect", handleStandardAccountChange);
    };
  }, [wallet]);

  return <>{children}</>;
};
