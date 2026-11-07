import { useOnline } from "@/shared/lib/hooks/use-online";
import type { Stage } from "@/views/flow/state/stage";

import { useAnnouncement } from "../model/announce";
import { noticeCondition, stageNotice } from "../model/notice";
import { useNetworkInput, useStatus } from "../model/use-status";

export interface StatusAnnouncerProps {
  /** The stage showing, whose notice speaks for itself; undefined over Home
   * and the catalog pages, where no notice is drawn */
  stage: Stage | undefined;
}

/**
 * The one polite live region for the indicators (Spec 06 RUN-40). `Flow`
 * mounts it above the frame: the status row, the rail and the chip swap at
 * the breakpoints, and a region that remounts has nothing to change.
 */
export const StatusAnnouncer = ({ stage }: StatusAnnouncerProps) => {
  const indicators = useStatus();
  const network = useNetworkInput();
  const condition = noticeCondition(network, useOnline());
  const notice = stage && stageNotice(condition, network.name, stage);
  const text = useAnnouncement(indicators, notice);
  return <output className="sr-only">{text}</output>;
};
