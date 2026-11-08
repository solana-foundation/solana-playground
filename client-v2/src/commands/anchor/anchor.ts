import {
  PgGlobal,
  PgPackage,
  PgSettings,
  TerminalLineError,
} from "../../utils";
import { checkPgWallet } from "../checks";
import { createCmd } from "../create";
import { refuseMainnetWith } from "../deploy/check-not-mainnet";
import { IDL_REFUSAL } from "../deploy/mainnet-block";

const refuseIdlWriteOnMainnet = refuseMainnetWith(IDL_REFUSAL);

/**
 * The `anchor idl` subcommands that only read or print. Every other one is
 * taken as a send from the Playground wallet (`init`, `upgrade`, `close` and
 * the buffer and authority writes in wasm/anchor-cli/src/commands/idl.rs), so
 * a subcommand added there later is refused on mainnet until listed here.
 */
const IDL_READS = new Set(["fetch", "authority", "help"]);

/** Whether `raw` (`anchor idl <sub> ...`) sends a transaction; help only prints */
export const isIdlWrite = (raw: string) => {
  const words = raw.trim().split(/\s+/);
  const [, group, sub] = words;
  if (words.includes("--help") || words.includes("-h")) return false;
  return group === "idl" && sub !== undefined && !IDL_READS.has(sub);
};

export const anchor = createCmd({
  name: "anchor",
  description: "Anchor CLI",
  needsConnection: true,
  preChecks: checkPgWallet,
  handle: async (input) => {
    if (!isIdlWrite(input.raw)) {
      const { runAnchor } = await PgPackage.import("anchor-cli", {
        log: true,
      });
      await runAnchor(input.raw);
      return;
    }

    // Mainnet IDL writes are refused in the beta (HOO-2737). The network is
    // read from the endpoint the WASM CLI sends to, not the cached cluster,
    // and Settings holds it until the command ends: the CLI reads it again
    // for every transaction (`idl init` writes after its create confirms).
    PgGlobal.idlWriting = true;
    try {
      const endpoint = PgSettings.connection.endpoint;
      await refuseIdlWriteOnMainnet(endpoint);

      const { runAnchor } = await PgPackage.import("anchor-cli", {
        log: true,
      });
      // Settings is held, but not every network switch goes through it: an
      // endpoint changed while the CLI loaded was never checked
      if (PgSettings.connection.endpoint !== endpoint) {
        throw new TerminalLineError(IDL_REFUSAL.unread);
      }

      await runAnchor(input.raw);
    } finally {
      PgGlobal.idlWriting = false;
    }
  },
});
