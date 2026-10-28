import { createTracker } from "../../../shared/lib/telemetry";
import type { FailureReason } from "./fund";

/** The Playground's cluster, as `PgConnection.cluster` names it */
export type FundCluster =
  | "mainnet-beta"
  | "devnet"
  | "testnet"
  | "localnet"
  | "playnet";

type FundEvents = {
  /** The Fund dialog opened; `from` is the control that opened it. */
  fund_dialog_opened: { from: "account-menu" };
  /**
   * A wallet connected inside the dialog to pay; `wallet` is its Wallet
   * Standard name (Phantom, Solflare), never an address.
   */
  fund_wallet_connected: { wallet: string };
  /** A transfer to the Playground wallet was confirmed on `cluster`. */
  fund_sent: { cluster: FundCluster };
  /**
   * Connecting the paying wallet or sending failed; `reason` is `rejected`
   * when the user said no in the wallet. No amount or address is sent.
   */
  fund_failed: { stage: "connect" | "send"; reason: FailureReason };
};

export const fundTelemetry = createTracker<FundEvents>();
