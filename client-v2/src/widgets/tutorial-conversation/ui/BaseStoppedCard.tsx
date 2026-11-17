import { CircleStop } from "lucide-react";

import type { Act } from "@/entities/tutorial";

/** Each act's head once the learner stopped it (HOO-2822) */
export const STOPPED_TITLE: Record<Act, string> = {
  airdrop: "Airdrop stopped",
  build: "Build stopped",
  deploy: "Deploy stopped",
  buildDeploy: "Build and deploy stopped",
  run: "Run stopped",
  call: "Call stopped",
};

export interface BaseStoppedCardProps {
  act: Act;
}

/**
 * An act the learner stopped: one quiet row, no "failed", no error line and
 * nothing to explain. Nothing went wrong, so the card asks nothing of the
 * learner; the act's own "again" card under it is the way on (HOO-2822).
 */
const BaseStoppedCard = ({ act }: BaseStoppedCardProps) => (
  <div
    role="status"
    className="flex h-9 items-center gap-2 overflow-hidden rounded-control border border-border bg-surface-panel px-3"
  >
    <CircleStop
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground"
    />
    <span className="text-[0.8125rem] font-label whitespace-nowrap text-foreground">
      {STOPPED_TITLE[act]}
    </span>
  </div>
);

export default BaseStoppedCard;
