import { useEffect, useState } from "react";

import { PgSession } from "../../../features/auth";
import { PgCommand, PgConnection } from "../../../utils";

export const useAirdrop = () => {
  const [airdropCondition, setAirdropCondition] = useState(false);

  useEffect(() => {
    const { dispose } = PgConnection.onDidChangeCluster(() => {
      setAirdropCondition(!!PgConnection.getAirdropAmount());
    });
    return dispose;
  }, []);

  const airdrop = async () => {
    // A failed sign-in rejects to the caller, which tells the user: printed
    // to a folded console, or to none under Home, it reached nobody
    if (!PgSession.get()) await PgSession.signIn();
    await PgCommand.airdrop.execute();
  };

  return { airdrop, airdropCondition };
};
