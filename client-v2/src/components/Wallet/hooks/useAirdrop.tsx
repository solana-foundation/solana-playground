import { useEffect, useState } from "react";

import { PgSession } from "../../../features/auth";
import { PgCommand, PgConnection, PgTerminal } from "../../../utils";

export const useAirdrop = () => {
  const [airdropCondition, setAirdropCondition] = useState(false);

  useEffect(() => {
    const { dispose } = PgConnection.onDidChangeCluster(() => {
      setAirdropCondition(!!PgConnection.getAirdropAmount());
    });
    return dispose;
  }, []);

  const airdrop = async () => {
    if (!PgSession.get()) {
      try {
        await PgSession.signIn();
      } catch (e) {
        PgTerminal.println(PgTerminal.error((e as Error).message));
        return;
      }
    }
    await PgCommand.airdrop.execute();
  };

  return { airdrop, airdropCondition };
};
