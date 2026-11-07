import { PgPackage } from "../../utils";
import { checkKeyReadable, checkPgWallet, signsOffline } from "../checks";
import { createCmd } from "../create";

export const splToken = createCmd({
  name: "spl-token",
  description: "Commands for interacting with SPL Tokens",
  needsConnection: true,
  preChecks: [checkKeyReadable(signsOffline), checkPgWallet],
  handle: async (input) => {
    const { runSplToken } = await PgPackage.import("spl-token-cli", {
      log: true,
    });

    await runSplToken(input.raw);
  },
});
