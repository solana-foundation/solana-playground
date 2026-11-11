import { createTracker } from "@/shared/lib/telemetry";

import type { FailureReason } from "./fund";

/** The Playground's cluster, as `PgConnection.cluster` names it */
export type FundCluster =
  | "mainnet-beta"
  | "devnet"
  | "testnet"
  | "localnet"
  | "playnet";

/** The control that opened the Fund dialog */
export type FundFrom =
  | "account-menu"
  | "wallet-chip"
  /** The Deploy stage's "Not enough SOL" card */
  | "deploy-card"
  /** The tutorial's "Not enough devnet SOL" cards */
  | "tutorial-card"
  /** The wallet menu's "The faucet is at its limit." toast */
  | "faucet-toast";

type FundEvents = {
  /** The Fund dialog opened; `from` is the control that opened it. */
  fund_dialog_opened: { from: FundFrom };
  /** The wallet chip's popover asked the faucet for SOL. */
  fund_airdrop_requested: { from: "wallet-chip" };
  /**
   * The faucet sent SOL; `via` is `faucet` for the chip's own ask and
   * `web-faucet` when the balance rose after the web faucet was opened.
   */
  fund_airdrop_received: { via: "faucet" | "web-faucet" };
  /**
   * The chip's ask came back without SOL: `rate-limited` for the faucet's
   * limit, `failed` for anything else but a sign-in the user did not finish.
   */
  fund_airdrop_refused: { reason: "rate-limited" | "failed" };
  /** The web faucet opened from the chip, after the faucet refused. */
  fund_web_faucet_opened: { from: "wallet-chip" };
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
