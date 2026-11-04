import { Share } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export interface BaseShareButtonProps {
  /** The open project's name, which the button's accessible name carries */
  name: string;
  /** Open the share dialog for that project */
  onShare: () => void;
}

/**
 * Drawn as the stage bar's icons (BaseStageBar's `BAR_CONTROL`): a 32 px
 * square, a thin 18 px icon, so the row reads as one set.
 * TODO(design-system): a bar icon size in the kit's Button, then drop this
 * and the bar's copy
 */
const BAR_CONTROL =
  "size-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-[18px] [&_svg]:stroke-[1.6]";

/**
 * The frame header's Share, drawn from what it is given: its name says which
 * project it shares, its tooltip reads "Share as a gist"
 */
const BaseShareButton = ({ name, onShare }: BaseShareButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        id="flow-share"
        type="button"
        variant="ghost"
        size="icon-sm"
        className={BAR_CONTROL}
        aria-label={`Share ${name}`}
        onClick={onShare}
      >
        <Share aria-hidden="true" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Share as a gist</TooltipContent>
  </Tooltip>
);

export default BaseShareButton;
