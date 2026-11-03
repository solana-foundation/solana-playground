import { TriangleAlertIcon, XIcon } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";

import type { StageNoticeView } from "../model/notice";

export interface BaseStageNoticeProps {
  notice: StageNoticeView | null;
  /** Asks the cluster again; the button is busy until it resolves */
  onRetry: () => Promise<unknown>;
  /** Opens the settings with the network field focused */
  onChangeNetwork: () => void;
  /** Puts the notice away until its condition ends and comes back */
  onDismiss: () => void;
}

/**
 * The line over the stage that says why work waits (Spec 08 NET-01, NET-02).
 * A warning callout, so it is announced as an alert; it clears by itself
 * when its condition ends. It can also be put away: on a phone it takes
 * three lines of the code for as long as the condition lasts, and the status
 * chip and row keep saying it meanwhile.
 */
const BaseStageNotice = ({
  notice,
  onRetry,
  onChangeNetwork,
  onDismiss,
}: BaseStageNoticeProps) => {
  if (!notice) return null;
  return (
    <div className="shrink-0 px-4 pt-3" data-testid="stage-notice">
      {/* A third column holds the close at the end of the first line, where
          a toast has its own */}
      <Callout
        variant="warning"
        className="has-[>svg]:grid-cols-[auto_1fr_auto]"
      >
        <TriangleAlertIcon />
        {/* Message left, buttons right; the buttons drop below when it gets
            narrow, as the sync banner's do */}
        <CalloutDescription className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 opacity-100">
          <p className="m-0 flex-[1_1_20rem] text-pretty text-foreground">
            {notice.text}
          </p>
          {notice.kind === "cluster-down" && (
            <div className="flex flex-wrap gap-2">
              <AsyncButton
                size="sm"
                variant="outline"
                loadingText="Trying…"
                onClick={onRetry}
                onError={reportButtonFailure("reach the network")}
              >
                Try again
              </AsyncButton>
              <Button size="sm" variant="outline" onClick={onChangeNetwork}>
                Change network
              </Button>
            </div>
          )}
        </CalloutDescription>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          // Pulled into the padding so it lines up with the first line and
          // does not make the callout taller; a fingertip on a touch screen
          className="-my-1 -mr-1.5 pointer-coarse:-my-2.5 pointer-coarse:-mr-2 pointer-coarse:size-11"
          onClick={onDismiss}
        >
          <XIcon />
        </Button>
      </Callout>
    </div>
  );
};

export default BaseStageNotice;
