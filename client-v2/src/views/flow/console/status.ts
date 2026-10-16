import { parseBuildReport } from "../stages/build-report";
import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
import type { FlowState } from "../state/stage";

/** Visual weight for the collapsed console handle's status text */
export type ConsoleStatusTone = "idle" | "success" | "error";

export interface ConsoleStatus {
  /** e.g. `building...`, `last build \u00b7 3.4s \u00b7 ok`, or `""`
   * before the first build */
  text: string;
  tone: ConsoleStatusTone;
}

/** `flow.buildMs` as `3.4s`, or `null` while it is unknown */
const buildTime = (ms: number | null) =>
  ms === null ? null : `${(ms / 1000).toFixed(1)}s`;

/**
 * The collapsed console handle's status line, derived from `PgFlow.state`
 * plus (only on a failed build) the first diagnostic code out of
 * `PgBuildOutput.latest` via `parseBuildReport`.
 *
 * Pure and framework-free so it is unit-testable without rendering
 * `ConsoleDrawer`; the component only has to call it on every `PgFlow`
 * change and on `PgBuildOutput` change (for the diagnostic code, which can
 * arrive slightly after the `build-finish` event that sets `flow.build`).
 *
 * Precedence (most recent/relevant first): a run in progress, then a
 * deploy result (it is always newer than the build that unlocked it), then
 * the last build's result, then nothing before the first build.
 */
export const describeConsoleStatus = (flow: FlowState): ConsoleStatus => {
  if (flow.build === "running") return { text: "building...", tone: "idle" };
  if (flow.deploy === "running") {
    return { text: "deploying...", tone: "idle" };
  }
  if (flow.deploy === "failed") {
    return { text: "deploy failed", tone: "error" };
  }
  if (flow.deploy === "done") return { text: "deploy ok", tone: "success" };
  if (flow.build === "failed") {
    const out = PgBuildOutput.latest;
    const code = out
      ? parseBuildReport(out.stderr).diagnostics[0]?.code ?? null
      : null;
    return {
      text: code ? `build failed \u00b7 ${code}` : "build failed",
      tone: "error",
    };
  }
  if (flow.build === "done") {
    const time = buildTime(flow.buildMs);
    return {
      text: time
        ? `last build \u00b7 ${time} \u00b7 ok`
        : "last build \u00b7 ok",
      tone: "success",
    };
  }
  return { text: "", tone: "idle" };
};
