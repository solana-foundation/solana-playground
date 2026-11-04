import { PgPackage } from "../../utils";
import { checkPgWallet } from "../checks";
import { createCmd } from "../create";

export const anchor = createCmd({
  name: "anchor",
  description: "Anchor CLI",
  preChecks: checkPgWallet,
  handle: async (input) => {
    const { runAnchor } = await PgPackage.import("anchor-cli", {
      log: true,
    });

    await runAnchor(input.raw);
  },
});
