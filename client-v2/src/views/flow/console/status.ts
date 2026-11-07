import type { VariantProps } from "class-variance-authority";

import type { statusDotVariants } from "@/shared/ui/status-dot";

import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
import { parseBuildReport } from "../stages/build-report";
import { msLabel } from "../stages/build-view";
import type { FlowState, RunKind } from "../state/stage";

type StatusDotVariant = NonNullable<
  VariantProps<typeof statusDotVariants>["variant"]
>;

/** Its argument, accepted only if every member is a `StatusDot` variant */
type DotVariants<T extends StatusDotVariant> = T;

/** Which `StatusDot` variant the console strip shows, and whether its text
 * reads as an error. tsc fails here if the dot drops one of them (an
 * `Extract` would drop the tone too, silently). */
export type ConsoleStatusTone = DotVariants<
  "idle" | "running" | "success" | "error"
>;

export interface ConsoleStatus {
  /** e.g. `Building… · 12 s`, `Built in 3.4 s`, or, with the tone `"idle"`,
   * `""` before the first build: a project with no program has the client
   * run hint there instead (`isClientRunHint`) */
  text: string;
  tone: ConsoleStatusTone;
}

/** The strip's words before a client run, in a project with no program */
const CLIENT_RUN_HINT = "Run the client to see its output here.";

/** Whether the strip shows the hint that asks for a client run */
const isClientRunHint = (status: ConsoleStatus) =>
  status.text === CLIENT_RUN_HINT;

/** Nothing to report: the strip before the first build */
const IDLE: ConsoleStatus = { text: "", tone: "idle" };

/** The status with the client run hint left out, for after a client run */
export const withoutClientRunHint = (status: ConsoleStatus) =>
  isClientRunHint(status) ? IDLE : status;

/** A run's words, with its whole seconds so far when they are known */
const running = (what: string, elapsedMs: number | null): ConsoleStatus => ({
  text:
    elapsedMs === null
      ? what
      : `${what} \u00b7 ${Math.floor(elapsedMs / 1000)} s`,
  tone: "running",
});

/**
 * The console strip's status line, in Spec 13's words and the design
 * system's ("Built in 11.8 s"), derived from `PgFlow.state` plus (only on a
 * failed build) the first diagnostic code out of `PgBuildOutput.latest` via
 * `parseBuildReport`. `elapsedMs` is how long the run in flight has taken,
 * which only the drawer's clock knows.
 *
 * Pure and framework-free so it is unit-testable without rendering
 * `ConsoleDrawer`; the component only has to call it on every `PgFlow`
 * change, on `PgBuildOutput` change (for the diagnostic code, which can
 * arrive slightly after the `build-finish` event that sets `flow.build`) and
 * on every tick of a run.
 *
 * Precedence (most recent/relevant first): a run in progress (a build, a
 * deploy, then an airdrop: a deploy's own top-up shows as the deploy), then a
 * stop, then a deploy result (it is always newer than the build that
 * unlocked it), then the last build's result, then nothing before the first
 * build. A project with no program never builds: where nothing else is
 * reported, the strip asks for the client's run, whose output the console
 * shows. The flow knows nothing of client runs, so the drawer drops the hint
 * once one has started (`isClientRunHint`).
 */
export const describeConsoleStatus = (
  flow: FlowState,
  elapsedMs: number | null = null
): ConsoleStatus => {
  if (flow.build === "running") return running("Building…", elapsedMs);
  if (flow.deploy === "running") return running("Deploying…", elapsedMs);
  // A deploy's own top-up is named by the deploy, above
  if (flow.airdrops > 0) return running("Airdropping…", elapsedMs);
  // A stop is newer than any result, and shows none (Spec 13)
  if (flow.stopped === "build") return { text: "Build stopped", tone: "idle" };
  if (flow.stopped === "deploy") {
    return { text: "Deploy stopped", tone: "idle" };
  }
  if (flow.deploy === "failed") {
    return { text: "Deploy failed", tone: "error" };
  }
  if (flow.deploy === "done") return { text: "Deployed", tone: "success" };
  if (flow.build === "failed") {
    const out = PgBuildOutput.latest;
    const code = out
      ? parseBuildReport(out.stderr).diagnostics[0]?.code ?? null
      : null;
    return {
      text: code ? `Build failed \u00b7 ${code}` : "Build failed",
      tone: "error",
    };
  }
  if (flow.build === "done") {
    const time = msLabel(flow.buildMs);
    return { text: time ? `Built in ${time}` : "Built", tone: "success" };
  }
  if (!flow.hasProgram) return { text: CLIENT_RUN_HINT, tone: "idle" };
  return IDLE;
};

/**
 * Which run the strip's Stop is named after, or `null` when the strip shows
 * no Stop. A running build names it, including the build a deploy runs first
 * (when the program is not built): it is what the strip says is running, and
 * Stop stops it and the deploy that started it. A deploy alone gets no Stop,
 * since pressing it there showed no effect; Ctrl+C in the terminal still
 * stops a deploy while it funds and writes. How the strip should stop a
 * deploy is a later task.
 */
export const runToStop = (flow: FlowState): RunKind | null =>
  flow.build === "running" ? "build" : null;
