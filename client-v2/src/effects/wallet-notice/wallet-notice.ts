import { PgWallet } from "../../utils";

/**
 * Show the wallet storage notices raised while the wallet loaded, before the
 * toast host listened. Effects run after the panels mount, so it listens now.
 */
export const walletNotice = () => {
  PgWallet.releaseNotices();
  return { dispose: () => {} };
};
