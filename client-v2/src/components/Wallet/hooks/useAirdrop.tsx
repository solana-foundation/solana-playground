import { useEffect, useState } from "react";

import { isAirdropSignInGated } from "../../../commands/airdrop/sign-in-gate";
import { withAirdropVia } from "../../../commands/airdrop/via";
import { PgSession } from "../../../features/auth";
import type { AirdropVia } from "../../../features/fund-wallet";
import { PgCommand, PgConnection } from "../../../utils";

/**
 * Whether the current cluster has a faucet. `unknown` until the cluster is
 * read, so the menu neither offers Airdrop nor says there is no faucet before
 * it can tell.
 */
export type Faucet = "unknown" | "available" | "none";

const faucetOf = (cluster: unknown): Faucet => {
  if (!cluster) return "unknown";
  return typeof PgConnection.getAirdropAmount() === "number"
    ? "available"
    : "none";
};

/**
 * The faucet's availability and an airdrop that signs in first where the
 * faucet asks for it; `via` names the control that runs it, for
 * `fund_airdropped`
 */
export const useAirdrop = (via: AirdropVia) => {
  const [faucet, setFaucet] = useState(() => faucetOf(PgConnection.cluster));

  useEffect(() => {
    const { dispose } = PgConnection.onDidChangeCluster((cluster) => {
      setFaucet(faucetOf(cluster));
    });
    return dispose;
  }, []);

  const airdrop = async () => {
    // Sign in only where the faucet is public (`isAirdropSignInGated`); a
    // local validator needs none. A failed sign-in rejects to the caller,
    // which tells the user: printed to a folded console, or to none under
    // Home, it reached nobody
    if (isAirdropSignInGated(PgConnection.cluster) && !PgSession.get()) {
      await PgSession.signIn();
    }
    await withAirdropVia(() => PgCommand.airdrop.execute(), via);
  };

  return { airdrop, faucet };
};
