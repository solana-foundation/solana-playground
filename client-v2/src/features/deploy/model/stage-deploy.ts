import { useSyncExternalStore } from "react";

import {
  DeployCancelledError,
  DeployFundingError,
  PgDeployRun,
} from "@/commands/deploy/run";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import type { Cluster } from "@/utils";
import { isStopped } from "@/utils/stopped";

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
      cluster: string | undefined;
      workspace: string | undefined;
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
      /** The run is waiting on "The last build failed" */
      askingStaleBuild: boolean;
    }
  | { phase: "stopped"; stop: StageStop }
  /** `backupFor` is the wallet address the backup line is shown for; absent, no line */
  | { phase: "done"; backupFor?: string };

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

  /**
   * Deploy the project's program from the stage; a second press is ignored
   *
   * @param onFailed called with a failure before it is reported, so the stage
   * can mark one it already shows in place (Spec 08's one message per cause)
   */
  static start(): Promise<void>;
  static start(onFailed: (error: unknown) => void): Promise<void>;
  static start(...handlers: [] | [onFailed: (error: unknown) => void]) {
    return PgStageDeploy._startWith("setting")(...handlers);
  }

  /**
   * Deploy as `start` does, and request an airdrop if the wallet is short:
   * the user pressed "Request airdrop" or signed in for the faucet
   */
  static startWithAirdrop(onFailed: (error: unknown) => void) {
    return PgStageDeploy._startWith("airdrop")(onFailed);
  }

  /**
   * Whether the run may airdrop: as `wallet.automaticAirdrop` says, or
   * because the user asked for one
   */
  private static _startWith =
    (funding: "setting" | "airdrop") =>
    async (...handlers: [] | [onFailed: (error: unknown) => void]) => {
      const [onFailed] = handlers;
      if (PgStageDeploy._running()) return;
      // Loaded here, not at the top: the slice's parts and helpers render in
      // places that never load the playground's runtime
      const {
        PgCommand,
        PgConnection,
        PgExplorer,
        PgGlobal,
        PgProgramInfo,
        PgSettings,
        PgWallet,
      } = await import("@/utils");
      // Read again: another press may have started a run during the import
      if (PgStageDeploy._running() || PgGlobal.deployState === "loading")
        return;
      PgStageDeploy._set({ phase: "running", askingStaleBuild: false });

      // The stage's state says "unknown" with `undefined`; the connection's `null` stays here
      const cluster = PgConnection.cluster ?? undefined;
      const workspace = PgExplorer.currentWorkspaceName;
      const redeploy = PgProgramInfo.onChain?.deployed === true;
      // A step recorded by an earlier run says nothing about this one, which
      // may fail before it reaches the deploy command
      let reachedRun = false;
      let result: Awaited<ReturnType<typeof PgCommand.deploy.execute>>;
      try {
        if (cluster) {
          deployTelemetry.track("deploy_started", { cluster, redeploy });
        }
        await ensurePlaygroundWallet(PgWallet);
        reachedRun = true;
        result = await PgDeployRun.runWith({
          confirmStaleBuild: PgStageDeploy._askStaleBuild,
          airdrop: funding === "airdrop" || PgSettings.wallet.automaticAirdrop,
        })(() => PgCommand.deploy.execute());
      } catch (error) {
        PgStageDeploy._failed(error, {
          cluster,
          workspace,
          reachedRun,
          onFailed,
        });
        return;
      } finally {
        // A question still open when the run ended can no longer be answered
        PgStageDeploy._staleResolve?.(false);
        PgStageDeploy._staleResolve = undefined;
      }

      // A press that only paused or resumed a run reports nothing
      if (!result) {
        PgStageDeploy._set({ phase: "idle" });
        return;
      }
      let backupFor: string | undefined;
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
        // The network the run deployed to, which the user may have changed
        // since it started. A run that could not name it sends no event:
        // the network selected may not be the one it ran on.
        if (result.cluster) {
          deployTelemetry.track("deploy_succeeded", {
            cluster: result.cluster,
            redeploy,
          });
        }
        if (backupFor) deployTelemetry.track("deploy_backup_shown", {});
      } catch (error) {
        // The program is deployed and the line shows; only an event is lost
        log.error(error, { report: true, context: { after: "deploy" } });
      }
    };

  /** The user answered "The last build failed" */
  static answerStaleBuild(deploy: boolean) {
    const resolve = PgStageDeploy._staleResolve;
    PgStageDeploy._staleResolve = undefined;
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
    PgStageDeploy._set({ phase: "done" });
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
      cluster: Cluster | undefined;
      workspace: string | undefined;
      reachedRun: boolean;
      onFailed?: (error: unknown) => void;
    }
  ) {
    const { cluster, workspace } = run;
    // A Stop from the console ends the run as the user chose, not as a failure
    if (error instanceof DeployCancelledError || isStopped(error)) {
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
    run.onFailed?.(error);
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
  private static _staleResolve: ((deploy: boolean) => void) | undefined;
  private static readonly _listeners = new Set<() => void>();
}

/** The stage's run, re-rendering as it moves */
export const useStageDeploy = (): StageDeployState =>
  useSyncExternalStore(PgStageDeploy.onDidChange, () => PgStageDeploy.state);
