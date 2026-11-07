import { PgPackage } from "../../utils";
import { checkKeyReadable, checkPgWallet, type KeyRead } from "../checks";
import { createCmd } from "../create";

/**
 * The `anchor idl` subcommands that sign with the wallet's key
 * (`get_keypair` in `wasm/anchor-cli/src/commands/idl.rs`); `authority` and
 * `fetch` only read the cluster.
 */
const IDL_SIGNS = [
  "close",
  "erase-authority",
  "init",
  "set-authority",
  "set-buffer",
  "upgrade",
  "write-buffer",
];

/** Which `anchor` run reads the key: an `idl` subcommand that signs */
export const anchorReadsKey: KeyRead = (tokens) => {
  const [name, group, subcommand] = tokens;
  const asksForHelp = tokens.some((t) => ["-h", "--help"].includes(t));
  if (group !== "idl" || !subcommand || asksForHelp) return undefined;
  return IDL_SIGNS.includes(subcommand)
    ? [name, group, subcommand].join(" ")
    : undefined;
};

export const anchor = createCmd({
  name: "anchor",
  description: "Anchor CLI",
  needsConnection: true,
  preChecks: [checkKeyReadable(anchorReadsKey), checkPgWallet],
  handle: async (input) => {
    const { runAnchor } = await PgPackage.import("anchor-cli", {
      log: true,
    });

    await runAnchor(input.raw);
  },
});
