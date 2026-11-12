import { PgWallet } from "@/utils";

import { receiverOf } from "./fund";
import { openFundDialog } from "./open";
import type { FundFrom } from "./telemetry";

/** The receiver `deploy` pays from, read from `PgWallet` */
export const currentReceiver = () => {
  const current = PgWallet.current;
  // Only a Playground wallet can receive; an extension's key is absent while
  // it disconnects, before `PgWallet` hands back to the Playground wallet
  if (current?.isPg) {
    return receiverOf({
      current: {
        isPg: true,
        name: current.name,
        address: current.publicKey.toBase58(),
      },
      firstAccount: undefined,
    });
  }
  // Deriving the first account's key is the costly part: only when needed,
  // since the short-wallet entries read this on every render
  const first = PgWallet.accounts[0];
  return receiverOf({
    current: undefined,
    firstAccount: first
      ? {
          name: first.name,
          address: PgWallet.create(first).publicKey.toBase58(),
        }
      : undefined,
  });
};

/**
 * What a short-wallet entry's "Send from your wallet" does for the wallet at
 * `address`: open the Fund dialog, or `undefined` when the dialog would fund
 * another wallet (an extension is current, or another account pays). The
 * entry draws its button only for a function. Read at render: the Deploy
 * stage and the tutorial feed re-render on a wallet switch; the toast keeps
 * its first answer while it shows, and the dialog names who it funds.
 */
export const fundFor =
  (from: FundFrom) =>
  (address: string): (() => void) | undefined =>
    currentReceiver()?.address === address
      ? () => openFundDialog(from)
      : undefined;
