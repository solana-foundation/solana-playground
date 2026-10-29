import type { VariantProps } from "class-variance-authority";

import type { statusDotVariants } from "@/shared/ui/status-dot";
import { parseBuildReport } from "../stages/build-report";
import { msLabel } from "../stages/build-view";
import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
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
  /** e.g. `Building… · 12 s`, `Built in 3.4 s`, or `""` before the first
   * build, when the tone is `"idle"` */
  text: string;
  tone: ConsoleStatusTone;
}

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
 * Precedence (most recent/relevant first): a run in progress, then a
 * stop, then a deploy result (it is always newer than the build that
 * unlocked it), then the last build's result, then nothing before the first
 * build.
 */
export const describeConsoleStatus = (
  flow: FlowState,
  elapsedMs: number | null = null
): ConsoleStatus => {
  if (flow.build === "running") return running("Building…", elapsedMs);
  if (flow.deploy === "running") return running("Deploying…", elapsedMs);
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
  return { text: "", tone: "idle" };
};

/**
 * Which run the strip's Stop is named after, or `null` while nothing runs.
 * A build a deploy runs first (when the program is not built) names it: it is
 * what the strip says is running. Stop itself stops every run in flight.
 */
export const runToStop = (flow: FlowState): RunKind | null => {
  if (flow.build === "running") return "build";
  if (flow.deploy === "running") return "deploy";
  return null;
};
