import { PgPackage, PgSettings } from "../../utils";
import { checkPgWallet } from "../checks";
import { createCmd } from "../create";
import { refuseMainnet } from "../deploy/check-not-mainnet";
import { IDL_REFUSAL } from "../deploy/mainnet-block";

/**
 * The `anchor idl` subcommands that send a transaction signed by the
 * Playground wallet; `fetch` and `authority` only read
 */
const IDL_WRITES = new Set([
  "init",
  "upgrade",
  "write-buffer",
  "set-buffer",
  "close",
  "set-authority",
  "erase-authority",
]);

/** Whether `raw` (`anchor idl <sub> ...`) sends a transaction; help only prints */
export const isIdlWrite = (raw: string) => {
  const words = raw.trim().split(/\s+/);
  const [, group, sub] = words;
  if (words.includes("--help") || words.includes("-h")) return false;
  return group === "idl" && IDL_WRITES.has(sub);
};

export const anchor = createCmd({
  name: "anchor",
  description: "Anchor CLI",
  needsConnection: true,
  preChecks: checkPgWallet,
  handle: async (input) => {
    // Mainnet IDL writes are refused in the beta (HOO-2737). The network is
    // read from the endpoint the WASM CLI sends to, not the cached cluster.
    if (isIdlWrite(input.raw)) {
      await refuseMainnet(PgSettings.connection.endpoint, IDL_REFUSAL);
    }

    const { runAnchor } = await PgPackage.import("anchor-cli", {
      log: true,
    });

    await runAnchor(input.raw);
  },
});
