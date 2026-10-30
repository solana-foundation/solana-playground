import { useSyncExternalStore } from "react";

import {
  DeployCancelledError,
  DeployFundingError,
  PgDeployRun,
} from "@/commands/deploy/run";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import type { Cluster } from "@/utils";
import { createLogger } from "@/shared/lib/logger";
import { answerBackup, isBackupAnswered } from "./backup";
import { deployTelemetry } from "./telemetry";

const log = createLogger("deploy:stage");

/**
 * How the stage's last run stopped short of a deploy. A funding stop names
 * the project and network it ran on, so another project or network never
 * shows its card; a cancel shows nothing anywhere.
 */
export type StageStop =
  | {
      kind: "funding";
      detail: DeployFundingError["detail"];
      cluster: string | null;
      workspace: string | null;
    }
  | { kind: "cancelled" };

/**
 * The stage's run, kept outside the stage: the stage router remounts it on
 * every switch, and a question or an outcome must outlive that. One phase at
 * a time, so a question, a stop and the backup line never show together.
 */
export type StageDeployState =
  | { phase: "idle" }
  | {
      phase: "running";
      /** The run is waiting on "Your last build failed" */
      askingStaleBuild: boolean;
    }
  | { phase: "stopped"; stop: StageStop }
  /** `backupFor` is the wallet address the backup line is shown for */
  | { phase: "done"; backupFor: string | null };

/** How long a new Playground wallet may take to become current */
const WALLET_TIMEOUT_MS = 15_000;

/**
 * Connect the Playground wallet a stage deploy pays from, without a dialog:
 * the current account, else the first, else a new one. Resolves once it is
 * `PgWallet.current`, which is derived asynchronously: the deploy's own
 * wallet check would otherwise ask in the terminal.
 */
const ensurePlaygroundWallet = async (
  PgWallet: typeof import("@/utils").PgWallet
) => {
  if (PgWallet.current) return;
  let dispose = () => {};
  const connected = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "The Playground wallet did not connect. Reload the page, then deploy again."
          )
        ),
      WALLET_TIMEOUT_MS
    );
    const sub = PgWallet.onDidChangeCurrent((current) => {
      if (!current) return;
      clearTimeout(timer);
      resolve();
    });
    dispose = () => {
      clearTimeout(timer);
      sub.dispose();
    };
  });
  try {
    if (PgWallet.accounts.length === 0) PgWallet.add();
    else PgWallet.switch(Math.max(PgWallet.currentIndex, 0));
    await connected;
  } finally {
    dispose();
  }
};

/** The Deploy stage's runs: started, answered and finished here */
export class PgStageDeploy {
  static get state(): StageDeployState {
    return PgStageDeploy._state;
  }

  static onDidChange(cb: () => void) {
    PgStageDeploy._listeners.add(cb);
    return () => {
      PgStageDeploy._listeners.delete(cb);
    };
  }

  /** Deploy the project's program from the stage; a second press is ignored */
  static async start() {
    if (PgStageDeploy._running()) return;
    // Loaded here, not at the top: the slice's parts and helpers render in
    // places that never load the playground's runtime
    const {
      PgCommand,
      PgConnection,
      PgExplorer,
      PgGlobal,
      PgProgramInfo,
      PgWallet,
    } = await import("@/utils");
    // Read again: another press may have started a run during the import
    if (PgStageDeploy._running() || PgGlobal.deployState === "loading") return;
    PgStageDeploy._set({ phase: "running", askingStaleBuild: false });

    const cluster = PgConnection.cluster;
    const workspace = PgExplorer.currentWorkspaceName ?? null;
    const redeploy = PgProgramInfo.onChain?.deployed === true;
    // A step recorded by an earlier run says nothing about this one, which
    // may fail before it reaches the deploy command
    let reachedRun = false;
    let result: Awaited<ReturnType<typeof PgCommand.deploy.execute>>;
    try {
      // Interact's deployment switcher may have pointed the project at an
      // imported id; redeploying always targets the project's own key,
      // never whatever Interact last selected.
      PgProgramInfo.update({ customPk: null });
      if (cluster) {
        deployTelemetry.track("deploy_started", { cluster, redeploy });
      }
      await ensurePlaygroundWallet(PgWallet);
      reachedRun = true;
      result = await PgDeployRun.withAnswers(
        { confirmStaleBuild: PgStageDeploy._askStaleBuild },
        () => PgCommand.deploy.execute()
      );
    } catch (error) {
      PgStageDeploy._failed(error, { cluster, workspace, reachedRun });
      return;
    } finally {
      // A question still open when the run ended can no longer be answered
      PgStageDeploy._staleResolve?.(false);
      PgStageDeploy._staleResolve = null;
    }

    // A press that only paused or resumed a run reports nothing
    if (!result) {
      PgStageDeploy._set({ phase: "idle" });
      return;
    }
    let backupFor: string | null = null;
    try {
      const paidBy = PgWallet.current;
      if (paidBy?.isPg) {
        const address = paidBy.publicKey.toBase58();
        if (!isBackupAnswered(address)) backupFor = address;
      }
    } catch (error) {
      // The program is deployed; without the wallet's address only the
      // backup line is lost, and the stage must still leave "running"
      log.error(error, { report: true, context: { after: "deploy" } });
    }
    PgStageDeploy._set({ phase: "done", backupFor });
    try {
      if (cluster) {
        deployTelemetry.track("deploy_succeeded", { cluster, redeploy });
      }
      if (backupFor) deployTelemetry.track("deploy_backup_shown", {});
    } catch (error) {
      // The program is deployed and the line shows; only an event is lost
      log.error(error, { report: true, context: { after: "deploy" } });
    }
  }

  /** The user answered "Your last build failed" */
  static answerStaleBuild(deploy: boolean) {
    const resolve = PgStageDeploy._staleResolve;
    PgStageDeploy._staleResolve = null;
    if (PgStageDeploy._state.phase === "running") {
      PgStageDeploy._set({ phase: "running", askingStaleBuild: false });
    }
    resolve?.(deploy);
  }

  /**
   * The user answered the backup line; it stays hidden for this wallet for
   * the page view even when the answer could not be stored
   */
  static answerBackup(saved: boolean) {
    const state = PgStageDeploy._state;
    if (state.phase !== "done" || !state.backupFor) return;
    answerBackup(state.backupFor);
    deployTelemetry.track(
      saved ? "deploy_backup_saved" : "deploy_backup_dismissed",
      {}
    );
    PgStageDeploy._set({ phase: "done", backupFor: null });
  }

  private static _askStaleBuild = () =>
    new Promise<boolean>((resolve) => {
      // Another run's question, if one is somehow open, is answered no
      // rather than left to hang
      PgStageDeploy._staleResolve?.(false);
      // A run that has already ended takes no question
      if (!PgStageDeploy._running()) {
        resolve(false);
        return;
      }
      PgStageDeploy._staleResolve = resolve;
      PgStageDeploy._set({ phase: "running", askingStaleBuild: true });
    });

  private static _failed(
    error: unknown,
    run: {
      cluster: Cluster | null;
      workspace: string | null;
      reachedRun: boolean;
    }
  ) {
    const { cluster, workspace } = run;
    if (error instanceof DeployCancelledError) {
      PgStageDeploy._set({ phase: "stopped", stop: { kind: "cancelled" } });
      return;
    }
    if (error instanceof DeployFundingError) {
      PgStageDeploy._set({
        phase: "stopped",
        stop: { kind: "funding", detail: error.detail, cluster, workspace },
      });
      if (cluster) {
        deployTelemetry.track("deploy_sol_needed_shown", {
          cluster,
          reason: error.detail.reason,
        });
        deployTelemetry.track("deploy_failed", { cluster, step: "funding" });
      }
      return;
    }
    if (cluster) {
      deployTelemetry.track("deploy_failed", {
        cluster,
        step: (run.reachedRun && PgDeployRun.lastStep) || "checks",
      });
    }
    PgStageDeploy._set({ phase: "idle" });
    reportButtonFailure("deploy")(error);
  }

  private static _running() {
    return PgStageDeploy._state.phase === "running";
  }

  private static _set(next: StageDeployState) {
    PgStageDeploy._state = next;
    for (const cb of PgStageDeploy._listeners) cb();
  }

  private static _state: StageDeployState = { phase: "idle" };
  private static _staleResolve: ((deploy: boolean) => void) | null = null;
  private static readonly _listeners = new Set<() => void>();
}

/** The stage's run, re-rendering as it moves */
export const useStageDeploy = (): StageDeployState =>
  useSyncExternalStore(PgStageDeploy.onDidChange, () => PgStageDeploy.state);
