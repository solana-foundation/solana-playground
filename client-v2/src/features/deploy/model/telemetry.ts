import { createTracker } from "@/shared/lib/telemetry";
import type { NoParams } from "@/shared/lib/telemetry";

/** The network a deploy went to, as `PgConnection.cluster` names it */
export type DeployCluster =
  | "mainnet-beta"
  | "devnet"
  | "testnet"
  | "localnet"
  | "playnet";

/** The step a deploy stopped at; `checks` is before anything was sent */
export type DeployFailedStep =
  | "checks"
  | "funding"
  | "buffer"
  | "write"
  | "deploy";

type DeployEvents = {
  /** A deploy started from the Deploy stage; `redeploy` when the program is already on the cluster. */
  deploy_started: { cluster: DeployCluster; redeploy: boolean };
  /** A deploy started from the stage finished on `cluster`. */
  deploy_succeeded: { cluster: DeployCluster; redeploy: boolean };
  /** A deploy started from the stage stopped with an error at `step`. */
  deploy_failed: { cluster: DeployCluster; step: DeployFailedStep };
  /**
   * The "Not enough SOL" card showed; `reason` says why the wallet could not
   * be funded. No balance or address is sent.
   */
  deploy_sol_needed_shown: {
    cluster: DeployCluster;
    reason: "signed_out" | "no_faucet" | "airdrop_failed";
  };
  /** The keypair backup line showed under a deploy result. */
  deploy_backup_shown: NoParams;
  /** "Save keypair" on the backup line downloaded the wallet's keypair. */
  deploy_backup_saved: NoParams;
  /** "Not now" hid the backup line for this wallet. */
  deploy_backup_dismissed: NoParams;
};

export const deployTelemetry = createTracker<DeployEvents>();
