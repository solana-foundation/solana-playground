import { useState } from "react";

import { useOnline } from "@/shared/lib/hooks/use-online";

import type { StatusIndicator } from "../model/indicators";
import { chipOf } from "../model/indicators";
import type { PickedFrom } from "../model/telemetry";
import { measured, statusTelemetry } from "../model/telemetry";
import { useStatus } from "../model/use-status";
import BaseStatusChip from "./BaseStatusChip";
import BaseStatusRail from "./BaseStatusRail";
import BaseStatusRow from "./BaseStatusRow";

/** Where the indicators' actions lead; `Flow` owns both places */
export interface StatusActions {
  /** Opens the settings on the network */
  onOpenNetwork: () => void;
  /** Opens Connect a model */
  onConnectAi: () => void;
}

export interface StatusProps extends StatusActions {
  settingsOpen: boolean;
}

const track = (indicator: StatusIndicator, from: PickedFrom) =>
  statusTelemetry.track("status_indicator_picked", {
    indicator: indicator.id,
    state: measured(indicator.state),
    from,
  });

/** Runs an indicator's action; the analyzer's is a reload of the page */
const act = (indicator: StatusIndicator, actions: StatusActions) => {
  switch (indicator.action?.kind) {
    case "network":
      actions.onOpenNetwork();
      return;
    case "ai":
      actions.onConnectAi();
      return;
    case "reload":
      // The worker cannot be torn down mid-retry (`PgCommon.tryUntilSuccess`),
      // so a fresh page is the restart
      window.location.reload();
      return;
    case undefined:
      return;
    default: {
      // A new action kind fails to compile here instead of doing nothing
      const unhandled: never = indicator.action;
      return unhandled;
    }
  }
};

/** The status row in the navigation's foot, on the live sources */
export const StatusRow = ({ settingsOpen, ...actions }: StatusProps) => {
  const indicators = useStatus();
  return (
    <BaseStatusRow
      indicators={indicators}
      settingsOpen={settingsOpen}
      onPick={(indicator) => {
        track(indicator, "row");
        // The analyzer's click only opens its panel
        if (indicator.id !== "rust") act(indicator, actions);
      }}
      onAction={(indicator) => {
        track(indicator, "row");
        act(indicator, actions);
      }}
    />
  );
};

/** The status row's three dots on the rail, on the live sources */
export const StatusRail = ({ settingsOpen, ...actions }: StatusProps) => {
  const indicators = useStatus();
  return (
    <BaseStatusRail
      indicators={indicators}
      settingsOpen={settingsOpen}
      onPick={(indicator) => {
        track(indicator, "rail");
        if (indicator.id !== "rust") act(indicator, actions);
      }}
      onAction={(indicator) => {
        track(indicator, "rail");
        act(indicator, actions);
      }}
    />
  );
};

/** The phone's status chip and sheet, on the live sources */
export const StatusChip = (actions: StatusActions) => {
  const indicators = useStatus();
  const chip = chipOf(indicators, useOnline());
  const [open, setOpen] = useState(false);
  return (
    <BaseStatusChip
      chip={chip}
      indicators={indicators}
      open={open}
      onOpenChange={(next) => {
        if (next) {
          statusTelemetry.track("status_sheet_opened", { worst: chip.state });
        }
        setOpen(next);
      }}
      onAction={(indicator) => {
        track(indicator, "sheet");
        act(indicator, actions);
      }}
    />
  );
};
