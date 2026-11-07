// Common command validation checks

import { PgCommand, PgTerminal, PgWallet, TerminalLineError } from "../utils";
import { keyCommandLine } from "../utils/wallet/key-origin/cli-line";

/** Check whether Playground Wallet is connected and ask to connect if not. */
export const checkPgWallet = async () => {
  if (!PgWallet.current?.isPg) {
    await connect("Your Playground wallet is not connected. Connect it?");
  }
};

/** Check whether any wallet is connected and ask to connect if not. */
export const checkWallet = async () => {
  // `connect` with no argument connects the Playground Wallet, so the
  // question names what a yes does
  if (!PgWallet.current) {
    await connect("No wallet is connected. Connect the Playground wallet?");
  }
};

/**
 * Ask Spec 13's wallet question; a yes connects, a no ends the command.
 *
 * @param question the question, without its `[Y/n]`
 * @throws {TerminalLineError} when the person answers no
 */
const connect = async (question: string) => {
  const term = await PgTerminal.get();
  const shouldConnect = await term.waitForInput(question, {
    confirm: true,
    default: "yes",
  });
  if (!shouldConnect) {
    throw new TerminalLineError(
      `Run \`${PgCommand.connect.name}\` to connect a wallet, then try again.`
    );
  }

  await PgCommand.connect.execute();
};

/**
 * Which run of a WASM CLI needs the built-in wallet's key in the page, named
 * as the person typed it, or `undefined` for a run that does not.
 */
export type KeyRead = (tokens: readonly string[]) => string | undefined;

/**
 * End a run that needs the built-in wallet's key in the page while the key
 * origin keeps it, before the wallet question and the WASM import. Under the
 * local provider it does nothing.
 *
 * @param readsKey which runs need the key in the page
 * @returns the pre-check
 */
export const checkKeyReadable =
  (readsKey: KeyRead) => (tokens: readonly string[]) => {
    if (PgWallet.hasKeysInPage()) return;
    const command = readsKey(tokens);
    if (command) throw new TerminalLineError(keyCommandLine(`\`${command}\``));
  };

/**
 * Whether the run only asks clap for help or the version: no arguments
 * (`arg_required_else_help`), `help`, or a help or version flag. clap answers
 * those before the CLI signs anything.
 */
const isClapOnlyAsk = (tokens: readonly string[]) =>
  tokens.length <= 1 ||
  tokens[1] === "help" ||
  tokens.some((t) => ["-h", "--help", "-V", "--version"].includes(t));

/**
 * Under the key origin `solana` and `spl-token` sign the wallet's slot at the
 * send step, through `PgWallet.signTransactionMessage`
 * (`wasm/utils/solana-playground-utils`, `wallet.rs`). A `--sign-only` run
 * prints signatures without sending, so nothing would ask the key page and
 * the run would need the key itself.
 */
export const signsOffline: KeyRead = (tokens) =>
  isClapOnlyAsk(tokens) || !tokens.includes("--sign-only")
    ? undefined
    : `${tokens[0]} --sign-only`;
