// Common command validation checks

import { PgCommand, PgTerminal, PgWallet, TerminalLineError } from "../utils";

/** Check whether Playground Wallet is connected and ask to connect if not. */
export const checkPgWallet = async () => {
  if (!PgWallet.current?.isPg) {
    await connect("Playground Wallet is not connected. Connect it?");
  }
};

/** Check whether any wallet is connected and ask to connect if not. */
export const checkWallet = async () => {
  // `connect` with no argument connects the Playground Wallet, so the
  // question names what a yes does
  if (!PgWallet.current) {
    await connect("No wallet is connected. Connect the Playground Wallet?");
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
