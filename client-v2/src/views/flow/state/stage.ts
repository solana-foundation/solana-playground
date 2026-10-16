import {
  PgBuildOutput,
  stripKnownNoise,
} from "../../sidebar/assistant/bridge/build-output";
import { PgCommand, PgExplorer, PgGlobal, PgProgramInfo } from "../../../utils";
import type { Disposable } from "../../../utils";

export type Stage = "write" | "build" | "deploy" | "interact";
export type StageStatus = "upcoming" | "active" | "done" | "failed" | "running";

export interface FlowState {
  stage: Stage;
  build: StageStatus;
  /** The last build status that was not "running". The Build surface is
   * chosen by this, never by the run in flight, so an instant failure
   * cannot blink the surface -- and unlike component state it survives a
   * remount mid-run. */
  buildSettled: StageStatus;
  deploy: StageStatus;
  interact: StageStatus;
  buildErrorCount: number;
  buildMs: number | null;
  /** When the current/last build run started, or `null` before the first
   * run. Lets a stage tell a stale `PgBuildOutput` apart from the one that
   * belongs to this run. */
  buildStartedAt: number | null;
}

export type FlowEvent =
  | { type: "build-start"; at: number }
  | { type: "build-finish"; failed: boolean; errorCount: number; ms: number }
  | { type: "deploy-start" }
  | { type: "deploy-finish"; ok: boolean }
  | { type: "set-stage"; stage: Stage }
  | { type: "workspace-change" }
  /**
   * What the workspace already knows about itself, read back after a
   * reload. `built` is `PgProgramInfo.lastBuildFailed`: `null` when this
   * workspace has never been built.
   */
  | { type: "restore"; built: boolean | null; deployed: boolean };

export const INITIAL_FLOW_STATE: FlowState = {
  stage: "write",
  build: "upcoming",
  buildSettled: "upcoming",
  deploy: "upcoming",
  interact: "upcoming",
  buildErrorCount: 0,
  buildMs: null,
  buildStartedAt: null,
};

export const STAGES: readonly Stage[] = [
  "write",
  "build",
  "deploy",
  "interact",
];

const ERROR_HEADER = /^error(?:\[E\d+\])?: (.+)$/;
// rustc's own summary lines are not a diagnostic of their own - matches
// `parseBuildReport`'s `SUMMARY` in `stages/build-report.ts` so the header
// count and the Build surface's count always agree.
const SUMMARY = /^(could not compile|aborting due to)/;

/** Count real diagnostics, the way `parseBuildReport` does */
export const countErrors = (stderr: string) =>
  stripKnownNoise(stderr)
    .split("\n")
    .filter((l) => {
      const head = l.match(ERROR_HEADER);
      return !!head && !SUMMARY.test(head[1]);
    }).length;

/**
 * The dev loop as state. Pure reducer plus a tiny store; `init` wires the
 * reducer to the events the client already emits.
 */
export class PgFlow {
  static get state(): FlowState {
    return PgFlow._state;
  }

  static setStage(stage: Stage) {
    PgFlow._dispatch({ type: "set-stage", stage });
  }

  static onDidChange(cb: (s: FlowState) => void): Disposable {
    PgFlow._listeners.add(cb);
    cb(PgFlow._state);
    return { dispose: () => PgFlow._listeners.delete(cb) };
  }

  static reduce(state: FlowState, ev: FlowEvent): FlowState {
    switch (ev.type) {
      case "build-start":
        return {
          ...state,
          stage: "build",
          build: "running",
          buildStartedAt: ev.at,
        };
      case "build-finish":
        return ev.failed
          ? {
              ...state,
              stage: "build",
              build: "failed",
              buildSettled: "failed",
              buildErrorCount: ev.errorCount,
              buildMs: ev.ms,
            }
          : {
              // Stay wherever the user is: the Build surface carries the
              // green summary and "Continue to Deploy", and pulling them
              // back to Write hid it (reported during the first demo run).
              ...state,
              build: "done",
              buildSettled: "done",
              deploy: state.deploy === "upcoming" ? "active" : state.deploy,
              buildErrorCount: 0,
              buildMs: ev.ms,
            };
      case "deploy-start":
        return { ...state, stage: "deploy", deploy: "running" };
      case "deploy-finish":
        return ev.ok
          ? { ...state, stage: "deploy", deploy: "done", interact: "active" }
          : { ...state, stage: "deploy", deploy: "failed" };
      case "set-stage":
        return { ...state, stage: ev.stage };
      case "workspace-change":
        return INITIAL_FLOW_STATE;
      case "restore": {
        // Seeds only forward: a stage the live session has already moved
        // off `upcoming` knows more about this run than the workspace's
        // record does, so the record never overwrites it. That is also
        // what makes a repeated restore idempotent.
        const recorded: StageStatus =
          ev.built === null ? "upcoming" : ev.built ? "failed" : "done";
        // A build in flight leaves `build` at "running" and `buildSettled`
        // on the previous verdict, so the same guard covers both: neither
        // is touched unless the stage is untouched.
        const fresh = state.build === "upcoming";
        return {
          ...state,
          build: fresh ? recorded : state.build,
          buildSettled: fresh ? recorded : state.buildSettled,
          // A recorded success points at Deploy the way `build-finish` does,
          // so a reload does not leave a finished Build with nothing saying
          // where to go next.
          deploy:
            state.deploy !== "upcoming"
              ? state.deploy
              : ev.deployed
              ? "done"
              : recorded === "done"
              ? "active"
              : state.deploy,
          interact:
            ev.deployed && state.interact === "upcoming"
              ? "active"
              : state.interact,
        };
      }
    }
  }

  /** Subscribe to client events. Call once from the Flow layout. */
  static init(): Disposable {
    let startedAt = 0;
    const subs: Disposable[] = [
      PgCommand.build.onDidStart(() => {
        startedAt = Date.now();
        PgFlow._dispatch({ type: "build-start", at: startedAt });
      }),
      PgBuildOutput.onDidChange((out) => {
        if (!out) return;
        PgFlow._dispatch({
          type: "build-finish",
          failed: out.failed,
          errorCount: out.failed ? Math.max(1, countErrors(out.stderr)) : 0,
          ms: startedAt === 0 ? 0 : out.at - startedAt,
        });
      }),
      // `PgBuildOutput` only fills in once `buildProgram()` resolves, so a
      // build that never reaches the compiler (e.g. the build server is
      // unreachable) leaves the stepper on "running" forever. Treat a
      // failed `build` command as a failed build unless the real output for
      // *this* run already arrived and handled it.
      PgCommand.build.onDidFinish((result) => {
        if (!("err" in result)) return;
        const out = PgBuildOutput.latest;
        if (out && out.at >= startedAt) return;
        PgFlow._dispatch({
          type: "build-finish",
          failed: true,
          errorCount: 0,
          ms: startedAt === 0 ? 0 : Date.now() - startedAt,
        });
      }),
      PgCommand.deploy.onDidStart(() =>
        PgFlow._dispatch({ type: "deploy-start" })
      ),
      PgCommand.deploy.onDidFinish((result) => {
        // A second click while a deploy is already running pauses it
        // (`PgGlobal.deployState` becomes "paused") or resumes it (becomes
        // "loading") and returns immediately with `ok: undefined` -- not a
        // real completion. The deploy command always resets the state to
        // "ready" before a genuine finish, success or failure, so that is
        // the only value that means the deploy actually ended.
        if (PgGlobal.deployState !== "ready") return;
        PgFlow._dispatch({
          type: "deploy-finish",
          ok: !("err" in result),
        });
      }),
      PgExplorer.onDidSwitchWorkspace(() =>
        PgFlow._dispatch({ type: "workspace-change" })
      ),
      // A reload drops this state but not the workspace's own: the build
      // verdict is in `program-info.json` and the deployment is on the
      // cluster. `onChain` is fetched asynchronously and re-derives on a
      // cluster or program id change, so this fires more than once --
      // `restore` seeds only forward, which is what makes that safe.
      PgProgramInfo.onDidChangeOnChain(() =>
        PgFlow._dispatch({
          type: "restore",
          built: PgProgramInfo.lastBuildFailed,
          deployed: !!PgProgramInfo.onChain?.deployed,
        })
      ),
    ];
    return { dispose: () => subs.forEach((s) => s.dispose()) };
  }

  private static _dispatch(ev: FlowEvent) {
    PgFlow._state = PgFlow.reduce(PgFlow._state, ev);
    for (const cb of PgFlow._listeners) cb(PgFlow._state);
  }

  private static _state: FlowState = INITIAL_FLOW_STATE;
  private static readonly _listeners = new Set<(s: FlowState) => void>();
}
