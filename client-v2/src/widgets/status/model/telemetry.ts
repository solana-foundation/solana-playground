import { createTracker } from "@/shared/lib/telemetry";

import type { IndicatorId, StatusState } from "./indicators";

/** Where an indicator was picked */
export type PickedFrom = "row" | "rail" | "sheet";

/** An indicator's state as measured: `idle` reads as ready, nothing waits */
export type MeasuredState = Exclude<StatusState, "idle">;

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
};

export const statusTelemetry = createTracker<StatusEvents>();

/** `idle` is measured as ready: nothing is waiting on it */
export const measured = (state: StatusState): MeasuredState =>
  state === "idle" ? "ready" : state;
