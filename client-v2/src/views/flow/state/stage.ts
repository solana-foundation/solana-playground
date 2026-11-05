import { createLogger } from "@/shared/lib/logger";

import { emptyFileOf } from "../../../commands/build/empty-source";
import { NetworkRefusedError } from "../../../commands/deploy/network-refused";
import type { Disposable } from "../../../utils";
import {
  PgCommand,
  PgExplorer,
  PgFramework,
  PgGlobal,
  PgProgramInfo,
} from "../../../utils";
import { isStopped } from "../../../utils/stopped";
import {
  PgBuildOutput,
  stripKnownNoise,
} from "../../sidebar/assistant/bridge/build-output";

const log = createLogger("flow:stage");

export type Stage = "write" | "build" | "deploy" | "interact";
export type StageStatus = "upcoming" | "active" | "done" | "failed" | "running";

/** A run the person can stop and the console strip reports as stopped */
export type RunKind = "build" | "deploy";

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
  /** `buildStartedAt` of the run before the one in flight, which a stopped
   * build goes back to, so the report it settled on stays current. Set by
   * `build-start`, read only by `build-stop`. */
  buildStartedBefore: number | null;
  /** Why the last build never reached the compiler, for Build's surface
   * and its "Show details"; `null` once a build settles otherwise */
  buildFailure: BuildFailure | null;
  /** What Deploy showed when the last deploy started, which a stopped
   * deploy goes back to; `null` until the first deploy starts. Set by
   * `deploy-start`, read only by `deploy-stop`. */
  deployBeforeRun: StageStatus | null;
  /** Which run the person stopped last, for the console strip's words;
   * `null` once the next run starts */
  stopped: RunKind | null;
  /** Whether the open project has a program to build. Without one, only the
   * Write stage is offered (`stagesOf`). */
  hasProgram: boolean;
  /** How many `airdrop` runs are in flight, for the console strip. The
   * terminal, the wallet's button, the automatic airdrop and a deploy's
   * top-up each start one, so two can overlap. It funds the wallet, not the
   * project, so a project switch keeps it. */
  airdrops: number;
  /** The program's source differs from what the last successful build was
   * given, so Build succeeded leads with Build again. `false` with no such
   * build in this session for the open workspace: a reload's "Built earlier"
   * claims no comparison, and this reads only on Build succeeded. */
  sourceChanged: boolean;
}

/**
 * A build that failed before the compiler said anything: `no-answer` when the
 * build server never replied (Spec 08's BUILD-04), `empty-source` when the
 * program file was empty and nothing was sent (Spec 09), `other` for anything
 * else (ANY-00). `message` is the command's own error, for the details.
 */
export type BuildFailure =
  | { kind: "no-answer" | "other"; message: string }
  | { kind: "empty-source"; message: string; file: string };

export type FlowEvent =
  | { type: "build-start"; at: number }
  | {
      type: "build-finish";
      failed: boolean;
      errorCount: number;
      ms: number;
      /** Why a build never reached the compiler */
      failure?: BuildFailure;
    }
  /** The person stopped the build: no result is kept, the stage goes back to
   * its settled status */
  | { type: "build-stop" }
  /**
   * `from`: the deploy command, whose events route to the Deploy stage, or a
   * tutorial's deploy act, which leaves the stage where it is
   */
  | { type: "deploy-start"; from: DeployFrom }
  | { type: "deploy-finish"; ok: boolean; from: DeployFrom }
  /** The person stopped the deploy before its last step: the program on
   * chain is as it was, and the stage goes back to where it was */
  | { type: "deploy-stop" }
  | { type: "airdrop-start" }
  | { type: "airdrop-finish" }
  /** The network was down, so the deploy never started: nothing changed */
  | { type: "deploy-refused" }
  | { type: "set-stage"; stage: Stage }
  | { type: "workspace-change" }
  /** What the open project's files say: whether `src/` holds a program */
  | { type: "program"; has: boolean }
  | { type: "source-change"; changed: boolean }
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
  buildStartedBefore: null,
  buildFailure: null,
  deployBeforeRun: null,
  stopped: null,
  // Nothing hides until the explorer has answered
  hasProgram: true,
  airdrops: 0,
  sourceChanged: false,
};

/** Every stage; `stagesOf` gives the ones the open project offers */
export const STAGES: readonly Stage[] = [
  "write",
  "build",
  "deploy",
  "interact",
];

/** The one stage a project with no program offers, shared so it keeps its identity */
const WRITE_ONLY: readonly Stage[] = ["write"];

/** The stages the given state offers: only Write for a project with no program */
export const stagesOf = (state: FlowState): readonly Stage[] =>
  state.hasProgram ? STAGES : WRITE_ONLY;

/**
 * Hold a project with no program on Write, whatever the event asked for, so
 * the router never shows a panel whose tab is hidden. The one place this is
 * enforced: `reduce` passes every result through it. A build started from
 * the terminal still runs; only the route stays.
 */
const onVisibleStage = (state: FlowState): FlowState =>
  state.hasProgram || state.stage === "write"
    ? state
    : { ...state, stage: "write" };

const ERROR_HEADER = /^error(?:\[E\d+\])?: (.+)$/;
// rustc's own summary lines are not a diagnostic of their own - matches
// `parseBuildReport`'s `SUMMARY` in `stages/build-report.ts` so the stepper
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

/** Who ran a deploy: the deploy command, or a tutorial's deploy act */
export type DeployFrom = "command" | "tutorial";

/** The command's deploy routes to the Deploy stage; a tutorial's keeps the editor */
const deployStage = (from: DeployFrom, state: FlowState): Stage =>
  from === "command" ? "deploy" : state.stage;

/**
 * What a `build` command's rejection says: about the server, or about an
 * empty program file it never sent. By shape, not `instanceof
 * PgServerError`: the flow's tests stand the utils barrel in with a
 * mock.
 */
const buildFailureOf = (err: unknown): BuildFailure => {
  const { answered, message } = (err ?? {}) as {
    answered?: unknown;
    message?: unknown;
  };
  const text = typeof message === "string" ? message : String(err);
  const emptyFile = emptyFileOf(err);
  if (emptyFile)
    return { kind: "empty-source", message: text, file: emptyFile };
  return { kind: answered === false ? "no-answer" : "other", message: text };
};

interface BuiltSource {
  workspace: string | undefined;
  source: string;
}

/** A program id's declaration, in Rust and in Python */
const DECLARED_ID = /declare_id(!?)\(\s*(["'])\w*\2\s*\)/g;

/**
 * What a build is compared by: the stored text of the files it sends, the
 * non-empty ones under `src/`. Two things are left out:
 *
 * - The declared program id. A build's start writes it into the open file
 *   (`Monaco.tsx`), which autosave stores after the build has its baseline, and
 *   the build sends the keypair's id whatever the file says; with it left in,
 *   every first build read as changed code moments after it succeeded.
 * - Paths, so a rename alone is no change, and so neither is moving a file
 *   within `src/` or swapping two files' text.
 */
export const programSourceIn =
  (srcPath: string) => (files: Record<string, { content?: string }>) =>
    JSON.stringify(
      Object.entries(files)
        .filter(([path, { content }]) => path.startsWith(srcPath) && content)
        .map(([, { content }]) =>
          content?.replace(DECLARED_ID, "declare_id$1()")
        )
        .sort()
    );

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

  /**
   * A deploy that does not go through `PgCommand.deploy` started: a
   * tutorial's deploy act (`tutorial-runs`). The terminal bar and the
   * drawer's first-deploy opening read the same state for both. The stage
   * stays where it is: the tutorial's editor, not the Deploy stage.
   */
  static deployStarted() {
    PgFlow._dispatch({ type: "deploy-start", from: "tutorial" });
  }

  /** That deploy ended, landed (`ok`) or not */
  static deployFinished(ok: boolean) {
    PgFlow._dispatch({ type: "deploy-finish", ok, from: "tutorial" });
  }

  static onDidChange(cb: (s: FlowState) => void): Disposable {
    PgFlow._listeners.add(cb);
    cb(PgFlow._state);
    return { dispose: () => PgFlow._listeners.delete(cb) };
  }

  static reduce(state: FlowState, ev: FlowEvent): FlowState {
    return onVisibleStage(PgFlow._step(state, ev));
  }

  /** The reducer before `onVisibleStage` holds a no-program project on Write */
  private static _step(state: FlowState, ev: FlowEvent): FlowState {
    switch (ev.type) {
      case "build-start":
        return {
          ...state,
          stage: "build",
          build: "running",
          buildStartedAt: ev.at,
          // A second start mid-run keeps the run before both, not the one in flight
          buildStartedBefore:
            state.build === "running"
              ? state.buildStartedBefore
              : state.buildStartedAt,
          stopped: null,
        };
      case "build-stop":
        if (state.build !== "running") return state;
        return {
          ...state,
          build: state.buildSettled,
          buildStartedAt: state.buildStartedBefore,
          stopped: "build",
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
              buildFailure: ev.failure ?? null,
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
              buildFailure: null,
            };
      case "deploy-start":
        // A second Deploy click pauses or resumes the run in flight and
        // starts again: what Deploy showed before is the first click's
        if (state.deploy === "running") return state;
        return {
          ...state,
          stage: deployStage(ev.from, state),
          deploy: "running",
          deployBeforeRun: state.deploy,
          stopped: null,
        };
      case "deploy-stop":
        if (state.deploy !== "running") return state;
        return {
          ...state,
          deploy: state.deployBeforeRun ?? "active",
          // A stop of the build a deploy runs first is the build's stop
          stopped: state.stopped === "build" ? "build" : "deploy",
        };
      case "deploy-refused":
        if (state.deploy !== "running") return state;
        return { ...state, deploy: state.deployBeforeRun ?? "active" };
      case "deploy-finish": {
        const stage = deployStage(ev.from, state);
        return ev.ok
          ? { ...state, stage, deploy: "done", interact: "active" }
          : { ...state, stage, deploy: "failed" };
      }
      case "set-stage":
        return { ...state, stage: ev.stage };
      case "program":
        // Unchanged on every other file event: listeners are not woken
        return state.hasProgram === ev.has
          ? state
          : { ...state, hasProgram: ev.has };
      case "workspace-change":
        // The previous project's answer holds until `_readProgram` gives the
        // new one: a reset to "has a program" would flash the stages, and
        // move a phone off the preview a project with no program shows
        return {
          ...INITIAL_FLOW_STATE,
          hasProgram: state.hasProgram,
          airdrops: state.airdrops,
        };
      case "airdrop-start":
        return { ...state, airdrops: state.airdrops + 1 };
      case "airdrop-finish":
        return state.airdrops
          ? { ...state, airdrops: state.airdrops - 1 }
          : state;
      case "source-change":
        return { ...state, sourceChanged: ev.changed };
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
    const recheckSource = () => PgFlow._recheckSource();
    const onTreeChange = () => {
      PgFlow._readProgram();
      recheckSource();
    };
    const subs: Disposable[] = [
      PgCommand.build.onDidStart(() => {
        startedAt = Date.now();
        PgFlow._dispatch({ type: "build-start", at: startedAt });
        PgFlow._running = { at: startedAt, source: PgFlow._currentSource() };
      }),
      PgBuildOutput.onDidChange((out) => {
        if (!out) return;
        // Subscribing replays the latest report, which may be older than the
        // build in flight, so only this run's own report settles it. Before
        // `build-finish`, so the surface never shows the success beside the
        // old answer.
        const run = PgFlow._running;
        if (run && out.at >= run.at) {
          if (!out.failed) PgFlow._built = run.source;
          PgFlow._running = undefined;
        }
        PgFlow._recheckSource();
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
        PgFlow._running = undefined;
        if (isStopped(result.err)) {
          PgFlow._dispatch({ type: "build-stop" });
          return;
        }
        const out = PgBuildOutput.latest;
        if (out && out.at >= startedAt) return;
        PgFlow._dispatch({
          type: "build-finish",
          failed: true,
          errorCount: 0,
          ms: startedAt === 0 ? 0 : Date.now() - startedAt,
          failure: buildFailureOf(result.err),
        });
      }),
      PgCommand.deploy.onDidStart(() =>
        PgFlow._dispatch({ type: "deploy-start", from: "command" })
      ),
      PgCommand.deploy.onDidFinish((result) => {
        // A second click while a deploy is already running pauses it
        // (`PgGlobal.deployState` becomes "paused") or resumes it (becomes
        // "loading") and returns immediately with `ok: undefined` -- not a
        // real completion. The deploy command always resets the state to
        // "ready" before a genuine finish, success or failure, so that is
        // the only value that means the deploy actually ended.
        if (PgGlobal.deployState !== "ready") return;
        if ("err" in result && isStopped(result.err)) {
          PgFlow._dispatch({ type: "deploy-stop" });
          return;
        }
        if ("err" in result && result.err instanceof NetworkRefusedError) {
          PgFlow._dispatch({ type: "deploy-refused" });
          return;
        }
        PgFlow._dispatch({
          type: "deploy-finish",
          ok: !("err" in result),
          from: "command",
        });
      }),
      PgCommand.airdrop.onDidStart(() =>
        PgFlow._dispatch({ type: "airdrop-start" })
      ),
      // Not `onDidFinish`, which `airdrop --help` never sends: the strip
      // would say "Airdropping…" for good
      PgCommand.airdrop.onDidEnd(() =>
        PgFlow._dispatch({ type: "airdrop-finish" })
      ),
      PgExplorer.onDidSwitchWorkspace(() => {
        PgFlow._dispatch({ type: "workspace-change" });
        // After the reset, which keeps the previous project's answer only
        // until this one replaces it
        PgFlow._readProgram();
        // Sync re-opens the workspace after a merge: the same project, with
        // another device's edit in it
        recheckSource();
      }),
      PgExplorer.onDidInit(PgFlow._readProgram),
      PgExplorer.onDidSaveFile(recheckSource),
      PgExplorer.onDidCreateItem(onTreeChange),
      PgExplorer.onDidDeleteItem(onTreeChange),
      PgExplorer.onDidRenameItem(onTreeChange),
      PgExplorer.onDidReloadFiles(recheckSource),
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
    // The layout may have been away while files changed
    recheckSource();
    return { dispose: () => subs.forEach((s) => s.dispose()) };
  }

  /** Tell the reducer whether the open project's `src/` holds a program */
  private static _readProgram() {
    if (!PgExplorer.isInitialized) return;
    let paths: string[];
    try {
      paths = Object.keys(PgExplorer.files).map((path) =>
        PgExplorer.getRelativePath(path)
      );
    } catch (error) {
      // A workspace being deleted or switched has no current path for a
      // moment; the switch that follows reads the files again
      log.warn("could not read the project's files for its stages", {
        context: { reason: error instanceof Error ? error.message : "unknown" },
      });
      return;
    }
    PgFlow._dispatch({ type: "program", has: PgFramework.hasProgram(paths) });
  }

  private static _currentSource(): BuiltSource {
    return {
      workspace: PgExplorer.currentWorkspaceName,
      source: programSourceIn(PgExplorer.getCurrentSrcPath())(PgExplorer.files),
    };
  }

  /**
   * In memory only: this runs on every change to the tree or a file, and
   * nothing here may touch the filesystem. By the workspace's name, as
   * `ownOutput` keeps the report.
   */
  private static _recheckSource() {
    const built = PgFlow._built;
    const changed =
      built !== undefined &&
      built.workspace === PgExplorer.currentWorkspaceName &&
      built.source !== PgFlow._currentSource().source;
    if (changed !== PgFlow._state.sourceChanged) {
      PgFlow._dispatch({ type: "source-change", changed });
    }
  }

  private static _dispatch(ev: FlowEvent) {
    const next = PgFlow.reduce(PgFlow._state, ev);
    if (next === PgFlow._state) return;
    PgFlow._state = next;
    for (const cb of PgFlow._listeners) cb(PgFlow._state);
  }

  private static _state: FlowState = INITIAL_FLOW_STATE;
  /** What the build in flight was given, until it settles */
  private static _running?: { at: number; source: BuiltSource };
  /** What the last successful build was given. A stopped or failed build
   * leaves it, so a stopped rebuild goes back to the surface it left with the
   * same answer. Static, as `_state` is: the layout re-subscribes on a remount
   * with both still on screen. */
  private static _built?: BuiltSource;
  private static readonly _listeners = new Set<(s: FlowState) => void>();
}
