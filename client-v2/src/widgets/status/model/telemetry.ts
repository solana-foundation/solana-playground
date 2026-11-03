import { createTracker } from "@/shared/lib/telemetry";
import type { IndicatorId, StatusState } from "./indicators";
import type { NoticeCondition } from "./notice";

/** Where an indicator was picked */
export type PickedFrom = "row" | "rail" | "sheet";

/** An indicator's state as measured: `idle` reads as ready, nothing waits;
 * `failed` reads as not ready, so the events keep the three values the spec
 * names */
export type MeasuredState = Exclude<StatusState, "idle" | "failed">;

type StatusEvents = {
  /** A user clicked an indicator in the status row or on the rail, or a
   * sheet row's action, with the indicator's state at that moment. */
  status_indicator_picked: {
    indicator: IndicatorId;
    state: MeasuredState;
    from: PickedFrom;
  };
  /** A user opened the phone's status sheet; `worst` is the chip's state. */
  status_sheet_opened: { worst: MeasuredState };
  /** A notice over the stage first showed since its condition began: not
   * again on a stage switch, but again once the condition has ended and come
   * back. */
  status_notice_shown: { notice: NoticeCondition };
  /** A user closed a notice over the stage; it stays away until its
   * condition ends and comes back. */
  status_notice_dismissed: { notice: NoticeCondition };
  /** A user pressed Try again or Change network on the cluster notice. */
  status_notice_action: {
    notice: Extract<NoticeCondition, "cluster-down">;
    action: "retry" | "change-network";
  };
};

export const statusTelemetry = createTracker<StatusEvents>();

const MEASURED: Record<StatusState, MeasuredState> = {
  ready: "ready",
  working: "working",
  "not-ready": "not-ready",
  failed: "not-ready",
  // Nothing is waiting on it
  idle: "ready",
};

export const measured = (state: StatusState): MeasuredState => MEASURED[state];

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/status/model/telemetry", () => {
    it("measures a failure as not ready and idle as ready", () => {
      const states = [
        "ready",
        "working",
        "not-ready",
        "failed",
        "idle",
      ] as const;
      expect(states.map(measured)).toEqual([
        "ready",
        "working",
        "not-ready",
        "not-ready",
        "ready",
      ]);
    });
  });
}
