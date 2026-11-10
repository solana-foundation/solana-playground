import { createTracker } from "@/shared/lib/telemetry";

import type { FailureReason } from "./fund";

/** The Playground's cluster, as `PgConnection.cluster` names it */
export type FundCluster =
  | "mainnet-beta"
  | "devnet"
  | "testnet"
  | "localnet"
  | "playnet";

/**
 * What asked the faucet for an airdrop: the `airdrop` command typed in the
 * terminal, the wallet menu's Airdrop item, the Interact stage's "needs SOL"
 * callout, a deploy's top-up, or the automatic airdrop on a low balance
 */
export type AirdropVia =
  | "terminal"
  | "wallet"
  | "stage"
  | "deploy"
  | "automatic";

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
   * A faucet airdrop arrived in the Playground wallet on `cluster`; `via` is
   * what asked for it. No amount or address is sent.
   */
  fund_airdropped: { via: AirdropVia; cluster: FundCluster };
  /**
   * Connecting the paying wallet or sending failed; `reason` is `rejected`
   * when the user said no in the wallet. No amount or address is sent.
   */
  fund_failed: { stage: "connect" | "send"; reason: FailureReason };
};

/**
 * Free text, opted in: no type lists the values, so the owner decides
 * whether to keep it (HOO-2752)
 */
type FundFreeText = {
  wallet: "a Wallet Standard name, which any installed wallet sets for itself";
};

export const fundTelemetry = createTracker<FundEvents, FundFreeText>();
