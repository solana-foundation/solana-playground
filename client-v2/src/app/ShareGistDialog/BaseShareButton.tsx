import { Button } from "@/shared/ui/button";
import { GithubMark } from "@/widgets/session-footer";

export interface BaseShareButtonProps {
  /** The open project's name, which the button's accessible name carries */
  name: string;
  /** Open the share dialog for that project */
  onShare: () => void;
}

/** The frame header's Share, drawn from what it is given */
const BaseShareButton = ({ name, onShare }: BaseShareButtonProps) => (
  <Button
    id="flow-share"
    type="button"
    variant="ghost"
    className="h-7.5 gap-1.5 rounded-lg pr-2.5 pl-2 text-[0.8125rem] text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent"
    aria-label={`Share ${name}`}
    onClick={onShare}
  >
    <GithubMark className="size-4" />
    Share
  </Button>
);

export default BaseShareButton;
