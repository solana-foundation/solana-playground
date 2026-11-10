import { isTerminalUnmounted, PgCommand, PgTerminal } from "../../utils";
import { connectTo } from "./connect";

/**
 * Run `connect` from a button. With a terminal mounted it runs there as a
 * command, so its lines print there. Under Home, which mounts no terminal, a
 * command fails with `TerminalUnmounted`, so `connectTo` runs instead and its
 * lines are dropped; the wallet setup is a modal and needs no terminal.
 *
 * The terminal is asked for first rather than the command's failure caught:
 * `connectTo` toggles on `PgWallet.state`, so running it after a command that
 * had already toggled would toggle the wallet back.
 *
 * @param walletName the standard wallet to toggle (lower case), or none to
 * toggle the Playground wallet
 * @throws what `connect` throws, such as `SETUP_REJECTED` when the user
 * closes the setup
 */
export const toggleWallet = async (walletName: string | undefined) => {
  try {
    await PgTerminal.get();
  } catch (error) {
    if (!isTerminalUnmounted(error)) throw error;
    await connectTo(walletName);
    return;
  }
  await (walletName
    ? PgCommand.connect.execute(walletName)
    : PgCommand.connect.execute());
};

/**
 * `toggleWallet` for the Playground wallet: connect it, or set it up on a
 * first visit, or disconnect it when it is on.
 *
 * @throws what `connect` throws, such as `SETUP_REJECTED` when the user
 * closes the setup
 */
export const connectWallet = () => toggleWallet(undefined);
