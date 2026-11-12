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
  /** The Fund dialog opened; `via` is the control that opened it. */
  fund_dialog_opened: { via: FundFrom };
  /** The wallet chip's popover asked the faucet for SOL. */
  fund_airdrop_requested: { via: "wallet-chip" };
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
  fund_web_faucet_opened: { via: "wallet-chip" };
  /**
   * A wallet connected; `wallet` is its Wallet Standard name (Phantom,
   * Solflare), never an address. `as` is `payer` inside the Fund dialog and
   * `current` from the wallet chip, where it becomes the current wallet.
   */
  fund_wallet_connected: { wallet: string; as: "payer" | "current" };
  /**
   * The wallet chip asked a wallet to connect (designers'
   * `wallet_connect_started`). Every request answers with `fund_wallet_connected`
   * or `fund_wallet_connect_failed`, also one a later pick superseded on screen.
   */
  fund_wallet_connect_started: { wallet: string };
  /**
   * The chip's connect did not happen; `reason` is `rejected` when the user
   * said no in the wallet.
   */
  fund_wallet_connect_failed: { wallet: string; reason: FailureReason };
  /** The chip disconnected the current wallet; the Playground wallet is back. */
  fund_wallet_disconnected: { wallet: string };
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
