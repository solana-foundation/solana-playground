import type { DeployFundingError } from "@/commands/deploy/run";
import type { StageDeployState } from "@/features/deploy";

import type { PgGlobal } from "../../../utils";
import type { StageStatus } from "../state/stage";

/** Why the last run could not fund its wallet */
export type FundingStop = DeployFundingError["detail"];

/**
 * What the Deploy stage shows, one at a time: a running deploy hides the
 * funding card, the failure and the backup line, whoever started it.
 */
export type DeployView =
  | { kind: "idle"; backup: boolean }
  | { kind: "running"; askingStaleBuild: boolean }
  | { kind: "funding"; stop: FundingStop }
  | { kind: "failed" };

/** The idle stage without a backup line, which a cancelled run also leaves */
export const IDLE_VIEW: Readonly<DeployView> = { kind: "idle", backup: false };

/** Where the stage is open now: the funding card and backup line belong to one place */
export interface DeployHere {
  /** The network picked; absent until the endpoint has been read */
  cluster: string | undefined;
  workspace: string | undefined;
  /** The current wallet's address; absent while none is current */
  wallet: string | undefined;
}

/** What the view is read from */
export interface DeployInputs {
  /** The stage's own run */
  stage: StageDeployState;
  /**
   * The global deploy state: a terminal `deploy` sets it to "loading" while
   * the stage's phase stays where its last run left it
   */
  deployState: typeof PgGlobal["deployState"] | undefined;
  /** The flow's last deploy result */
  flowDeploy: StageStatus;
}

/** The stage's one view, for the project and network open now (`here`) */
export const deployViewFor =
  (here: DeployHere) =>
  ({ stage, deployState, flowDeploy }: DeployInputs): DeployView => {
    if (deployState === "loading" || stage.phase === "running") {
      return {
        kind: "running",
        askingStaleBuild: stage.phase === "running" && stage.askingStaleBuild,
      };
    }
    if (stage.phase === "stopped") {
      const { stop } = stage;
      if (stop.kind === "cancelled") return IDLE_VIEW;
      const isOnThisProject =
        stop.cluster === here.cluster && stop.workspace === here.workspace;
      if (isOnThisProject) return { kind: "funding", stop: stop.detail };
    }
    if (flowDeploy === "failed") return { kind: "failed" };
    return {
      kind: "idle",
      backup:
        stage.phase === "done" &&
        stage.backupFor !== undefined &&
        stage.backupFor === here.wallet,
    };
  };

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const WALLET = "Wa11et11111111111111111111111111111111Payer";

  /** The stage open on devnet, project "counter", the Playground wallet current */
  const here = deployViewFor({
    cluster: "devnet",
    workspace: "counter",
    wallet: WALLET,
  });

  const DETAIL = {
    reason: "airdrop_failed",
    balance: 0,
    needed: 1_000_000_000,
    address: WALLET,
    cause: "429",
  } as const;

  const fundingStopOn = (
    cluster: string,
    workspace: string
  ): StageDeployState => ({
    phase: "stopped",
    stop: { kind: "funding", detail: DETAIL, cluster, workspace },
  });
  const FUNDING_HERE = fundingStopOn("devnet", "counter");

  const DONE_WITH_BACKUP: StageDeployState = {
    phase: "done",
    backupFor: WALLET,
  };

  describe("views/flow/stages/deploy-view", () => {
    it("shows only the running deploy when the terminal deploys over a funding stop", () => {
      expect(
        here({
          stage: FUNDING_HERE,
          deployState: "loading",
          flowDeploy: "failed",
        })
      ).toEqual({ kind: "running", askingStaleBuild: false });
    });

    it("shows only the running deploy when the terminal deploys after a backup line", () => {
      expect(
        here({
          stage: DONE_WITH_BACKUP,
          deployState: "loading",
          flowDeploy: "done",
        })
      ).toEqual({ kind: "running", askingStaleBuild: false });
    });

    it("asks about the stale build only while the stage's own run waits on it", () => {
      expect(
        here({
          stage: { phase: "running", askingStaleBuild: true },
          deployState: "loading",
          flowDeploy: "active",
        })
      ).toEqual({ kind: "running", askingStaleBuild: true });
    });

    it("shows the funding card for a stop on the project and network open now", () => {
      expect(
        here({
          stage: FUNDING_HERE,
          deployState: "ready",
          flowDeploy: "failed",
        })
      ).toEqual({ kind: "funding", stop: DETAIL });
    });

    it("shows a failure, not the card, for a funding stop on another network", () => {
      expect(
        here({
          stage: fundingStopOn("testnet", "counter"),
          deployState: "ready",
          flowDeploy: "failed",
        })
      ).toEqual({ kind: "failed" });
    });

    it("shows no card for a funding stop in another project", () => {
      expect(
        here({
          stage: fundingStopOn("devnet", "other"),
          deployState: "ready",
          flowDeploy: "active",
        })
      ).toEqual(IDLE_VIEW);
    });

    it("shows a failure for a funding stop in another project after a failed deploy", () => {
      expect(
        here({
          stage: fundingStopOn("devnet", "other"),
          deployState: "ready",
          flowDeploy: "failed",
        })
      ).toEqual({ kind: "failed" });
    });

    it("drops the backup line once the last deploy failed", () => {
      expect(
        here({
          stage: DONE_WITH_BACKUP,
          deployState: "ready",
          flowDeploy: "failed",
        })
      ).toEqual({ kind: "failed" });
    });

    it("keeps the stage's own run running while the global state lags", () => {
      expect(
        here({
          stage: { phase: "running", askingStaleBuild: true },
          deployState: "ready",
          flowDeploy: "active",
        })
      ).toEqual({ kind: "running", askingStaleBuild: true });
    });

    it("matches a funding stop with no project open to a stage with none", () => {
      expect(
        deployViewFor({
          cluster: "devnet",
          workspace: undefined,
          wallet: WALLET,
        })({
          stage: {
            phase: "stopped",
            stop: {
              kind: "funding",
              detail: DETAIL,
              cluster: "devnet",
              workspace: undefined,
            },
          },
          deployState: "ready",
          flowDeploy: "failed",
        })
      ).toEqual({ kind: "funding", stop: DETAIL });
    });

    it("treats a cancelled run as no failure", () => {
      expect(
        here({
          stage: { phase: "stopped", stop: { kind: "cancelled" } },
          deployState: "ready",
          flowDeploy: "failed",
        })
      ).toEqual(IDLE_VIEW);
    });

    it("shows no backup line with no wallet current and none asked for", () => {
      expect(
        deployViewFor({
          cluster: "devnet",
          workspace: "counter",
          wallet: undefined,
        })({
          stage: { phase: "done" },
          deployState: "ready",
          flowDeploy: "done",
        })
      ).toEqual(IDLE_VIEW);
    });

    it("offers the backup line for the wallet it was shown for, after a deploy", () => {
      const run = {
        stage: DONE_WITH_BACKUP,
        deployState: "ready",
        flowDeploy: "done",
      } as const;
      expect(here(run)).toEqual({ kind: "idle", backup: true });
      expect(
        deployViewFor({
          cluster: "devnet",
          workspace: "counter",
          wallet: "another wallet",
        })(run)
      ).toEqual(IDLE_VIEW);
    });
  });
}
