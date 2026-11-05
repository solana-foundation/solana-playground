import { TriangleAlertIcon, XIcon } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import {
  Callout,
  CalloutAction,
  CalloutActions,
  CalloutDescription,
} from "@/shared/ui/callout";

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
        <CalloutDescription className="min-w-0 opacity-100">
          <p className="m-0 text-pretty text-foreground">{notice.text}</p>
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
        {/* Under the text, as the sync banner's */}
        {notice.kind === "cluster-down" && (
          <CalloutActions>
            <CalloutAction asChild>
              <AsyncButton
                variant="ghost"
                size="sm"
                loadingText="Trying…"
                onClick={onRetry}
                onError={reportButtonFailure("reach the network")}
              >
                Try again
              </AsyncButton>
            </CalloutAction>
            <CalloutAction onClick={onChangeNetwork}>
              Change network
            </CalloutAction>
          </CalloutActions>
        )}
      </Callout>
    </div>
  );
};

export default BaseStageNotice;
