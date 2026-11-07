import { PgPackage } from "../../utils";
import { checkKeyReadable, checkPgWallet, signsOffline } from "../checks";
import { createCmd } from "../create";

export const solana = createCmd({
  name: "solana",
  description: "Commands for interacting with Solana",
  needsConnection: true,
  preChecks: [checkKeyReadable(signsOffline), checkPgWallet],
  handle: async (input) => {
    const { runSolana } = await PgPackage.import("solana-cli", {
      log: true,
    });

    await runSolana(input.raw);
  },
});
