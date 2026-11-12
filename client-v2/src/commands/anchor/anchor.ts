import {
  PgGlobal,
  PgPackage,
  PgSettings,
  TerminalLineError,
} from "../../utils";
import { checkPgWallet } from "../checks";
import { createCmd } from "../create";
import { refuseMainnetWith } from "../deploy/check-not-mainnet";
import { IDL_NETWORK_CHANGED, IDL_REFUSAL } from "../deploy/mainnet-block";

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
  preChecks: [checkPgWallet],
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
    // and it is held until the command ends: the CLI reads it again at each
    // step (`idl init` makes a new client for its write once the create
    // confirms, `idl upgrade` for its set-buffer). Every switch the user asks
    // for goes through Settings' `pickNetwork`, which refuses meanwhile.
    // A boolean is enough: the terminal is disabled while a command runs
    // (`PgTerm.process`), so no second write starts meanwhile.
    PgGlobal.isIdlWriting = true;
    try {
      const endpoint = PgSettings.connection.endpoint;
      await refuseIdlWriteOnMainnet(endpoint);

      const { runAnchor } = await PgPackage.import("anchor-cli", {
        log: true,
      });
      // The hold covers user switches only: an endpoint changed while the CLI
      // loaded, by anything else, was never checked
      if (PgSettings.connection.endpoint !== endpoint) {
        throw new TerminalLineError(IDL_NETWORK_CHANGED);
      }

      await runAnchor(input.raw);
    } finally {
      PgGlobal.isIdlWriting = false;
    }
  },
});
