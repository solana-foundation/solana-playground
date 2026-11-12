import { PgCommon, PgTerminal, PgView, PgWallet } from "../../utils";
import { createArgs, createCmd } from "../create";
import { PgDeployRun } from "../deploy/run";
import { SETUP_REJECTED } from "./setup-rejected";
import { WalletUnavailableError } from "./wallet-unavailable";

export const connect = createCmd({
  name: "connect",
  description: "Manage wallet connection",
  args: createArgs([
    {
      name: "wallet",
      optional: true,
      values: () => PgWallet.standardWallets.map((w) => w.name.toLowerCase()),
    },
  ]),
  handle: (input) => connectTo(input.args.wallet),
});

/**
 * What `connect` does. It needs no terminal: its lines go through
 * `PgTerminal.println`, which drops them while none is mounted.
 *
 * @param walletName the standard wallet to toggle (lower case), or none to
 * toggle the Playground wallet: off when it is on, on from no wallet, the
 * setup or an extension wallet
 */
export const connectTo = async (walletName: string | undefined) => {
  // A wallet that connects mid-deploy would change who signs the rest of it
  if (PgDeployRun.isActive) {
    throw new Error("Cannot connect a wallet while a deploy is running.");
  }
  switch (PgWallet.state) {
    case "pg": {
      const { changed } = await toggleStandardIfNeeded(walletName);
      if (!changed) {
        PgWallet.state = "disconnected";
        PgTerminal.println(PgTerminal.bold("Disconnected."));
        await confirm(() => !PgWallet.current);
      } else {
        await confirm(() => PgWallet.current);
      }

      break;
    }

    case "sol": {
      if (!PgWallet.current) {
        throw new Error("Not connected");
      }
      if (PgWallet.current.isPg) {
        throw new Error("Current wallet is not a Solana wallet");
      }

      const { changed } = await toggleStandardIfNeeded(walletName);
      if (!changed) {
        await PgWallet.current.disconnect();
        PgWallet.state = "pg";
        PgTerminal.println(
          PgTerminal.bold(`Disconnected from ${PgWallet.current.name}.`)
        );
        await confirm(() => PgWallet.current?.isPg);
      } else {
        await confirm(() => PgWallet.current && !PgWallet.current.isPg);
      }

      break;
    }

    case "disconnected": {
      const { changed } = await toggleStandardIfNeeded(walletName);
      if (!changed) {
        PgWallet.state = "pg";
        PgTerminal.println(PgTerminal.success("Connected."));
        await confirm(() => PgWallet.current?.isPg);
      } else {
        await confirm(() => PgWallet.current && !PgWallet.current.isPg);
      }

      break;
    }

    case "unavailable": {
      // Read it again, as Get set up's Try again does: once the list is
      // dismissed or completed, this is the only way to retry
      await PgWallet.refresh();
      if (PgWallet.state === "unavailable") throw new WalletUnavailableError();
      if (PgWallet.state === "pg" || PgWallet.state === "sol") {
        PgTerminal.println(PgTerminal.success("Wallet loaded."));
        break;
      }
      // Readable again but not connected: go on as `connect` from there
      // (Setup, or connecting the loaded wallet)
      await connectTo(walletName);
      break;
    }

    case "setup": {
      const { Setup } = await import("../../components/Wallet/Modals/Setup");
      const setupCompleted = await PgView.setModal<boolean>(Setup);
      if (!setupCompleted) throw new Error(SETUP_REJECTED);

      const { changed } = await toggleStandardIfNeeded(walletName);
      if (!changed) PgWallet.state = "pg";

      PgTerminal.println(PgTerminal.success("Setup completed."));
      await confirm(() => PgWallet.current?.isPg);
    }
  }
};

/**
 * Connect to or disconnect from a standard wallet based on given input.
 *
 * @param walletName wallet name from the command input (lower case)
 * @returns whether the current wallet has changed
 */
const toggleStandardIfNeeded = async (walletName: string | undefined) => {
  if (!walletName) return { changed: false };

  const wallet = PgWallet.standardWallets.find(
    (standardWallet) => standardWallet.name.toLowerCase() === walletName
  );
  if (!wallet) {
    throw new Error(`Given wallet '${walletName}' is not detected`);
  }

  if (!wallet.connected) {
    await setStandardCurrent(wallet.name);
    PgTerminal.println(PgTerminal.success(`Connected to ${wallet.name}.`));
  } else {
    await disconnectStandard(wallet.name);
    PgTerminal.println(PgTerminal.bold(`Disconnected from ${wallet.name}.`));
  }

  return { changed: true };
};

/** The installed standard wallet named `name`, as its `name` reads */
const standardNamed = (name: string) => {
  const wallet = PgWallet.standardWallets.find((w) => w.name === name);
  if (!wallet) throw new Error(`${name} is not installed in this browser.`);
  return wallet;
};

/**
 * Make the standard wallet `name` the current wallet, connecting it first
 * when it is not. One already connected (a payer the Fund dialog connected)
 * is made current as it is, never toggled off.
 *
 * @param isStillWanted asked once the wallet answers: a request that was
 * superseded meanwhile leaves the wallet connected but not current
 * @throws the wallet's own error when it declines; nothing changes then
 */
export const setStandardCurrentWith =
  (isStillWanted: () => boolean) => async (name: string) => {
    const wallet = standardNamed(name);
    if (!wallet.connected) await wallet.connect();
    if (!isStillWanted()) return;
    PgWallet.update({ state: "sol", standardName: wallet.name });
  };

/** `setStandardCurrentWith` for a request nothing supersedes */
export const setStandardCurrent = setStandardCurrentWith(() => true);

/** Disconnect the standard wallet `name`; the Playground wallet is current again */
export const disconnectStandard = async (name: string) => {
  try {
    await standardNamed(name).disconnect();
  } finally {
    // An extension that throws after dropping the site still leaves it: the
    // Playground wallet is current either way, never a wallet that is gone
    // eslint-disable-next-line unicorn/no-null -- `standardName` is `null` with no standard wallet current
    PgWallet.update({ state: "pg", standardName: null });
  }
};

/**
 * Confirm generic wallet connection state.
 *
 * This function will resolve once `check` returns a truthy value or on timeout.
 */
const confirm = async (check: () => any) => {
  const MAX_DURATION = 5000;
  const TRY_INTERVAL = 50;

  for (let i = 0; i * TRY_INTERVAL < MAX_DURATION; i++) {
    if (check()) return;
    await PgCommon.sleep(TRY_INTERVAL);
  }

  throw new Error("Failed to confirm wallet connection state");
};
