import { useEffect, useRef, useState } from "react";

import { useOnline } from "@/shared/lib/hooks/use-online";
import { PgConnection } from "@/utils";
import type { Stage } from "@/views/flow/state/stage";

import type { NoticeCondition } from "../model/notice";
import { noticeCondition, stageNotice } from "../model/notice";
import { statusTelemetry } from "../model/telemetry";
import { useNetworkInput } from "../model/use-status";
import BaseStageNotice from "./BaseStageNotice";

export interface StageNoticeProps {
  /** The stage shown under the notice: the cluster line is Deploy's and Interact's */
  stage: Stage;
  /** Opens the settings with the network field focused; `Flow` owns them */
  onOpenNetwork: () => void;
}

/** The line over the stage, on the live network and connection */
export const StageNotice = ({ stage, onOpenNetwork }: StageNoticeProps) => {
  const network = useNetworkInput();
  const online = useOnline();
  const condition = noticeCondition(network, online);
  const notice = stageNotice(condition, network.name, stage);

  // Put away for this episode only: once the condition ends or turns into
  // another, the next one shows again
  const [dismissed, setDismissed] = useState<NoticeCondition | undefined>(
    undefined
  );
  if (dismissed !== undefined && dismissed !== condition) {
    setDismissed(undefined);
  }

  // Once per onset of a condition, when it first shows: a stage switch that
  // hides and shows the same condition again is not a new one
  const told = useRef<NoticeCondition | undefined>(undefined);
  const shown = notice?.kind;
  useEffect(() => {
    if (condition === undefined) told.current = undefined;
    else if (shown !== undefined && told.current !== shown) {
      told.current = shown;
      statusTelemetry.track("status_notice_shown", { notice: shown });
    }
  }, [condition, shown]);

  return (
    <BaseStageNotice
      notice={dismissed === condition ? undefined : notice}
      onDismiss={() => {
        if (!notice) return;
        statusTelemetry.track("status_notice_dismissed", {
          notice: notice.kind,
        });
        setDismissed(notice.kind);
      }}
      onRetry={async () => {
        statusTelemetry.track("status_notice_action", {
          notice: "cluster-down",
          action: "retry",
        });
        // A cluster that still does not answer fails the press, so the button
        // says so ("Could not reach the network.") rather than going quiet
        // under the same notice
        if (!(await PgConnection.recheck())) {
          throw new Error(`${network.name} did not answer`);
        }
      }}
      onChangeNetwork={() => {
        statusTelemetry.track("status_notice_action", {
          notice: "cluster-down",
          action: "change-network",
        });
        onOpenNetwork();
      }}
    />
  );
};
