import { PgPackage } from "../../utils";
import { checkPgWallet } from "../checks";
import { createCmd } from "../create";

export const sugar = createCmd({
  name: "sugar",
  description:
    "Command line tool for creating and managing Metaplex Candy Machines",
  needsConnection: true,
  preChecks: checkPgWallet,
  handle: async (input) => {
    const { runSugar } = await PgPackage.import("sugar-cli", {
      log: true,
    });

    await runSugar(input.raw);
  },
});
