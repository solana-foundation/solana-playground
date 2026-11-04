import { PgPackage } from "../../utils";
import { checkPgWallet } from "../checks";
import { createCmd } from "../create";

export const solana = createCmd({
  name: "solana",
  description: "Commands for interacting with Solana",
  needsConnection: true,
  preChecks: checkPgWallet,
  handle: async (input) => {
    const { runSolana } = await PgPackage.import("solana-cli", {
      log: true,
    });

    await runSolana(input.raw);
  },
});
