import { ArrowUpRight, Bug, MessageCircle } from "lucide-react";

import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { GITHUB_LINKS } from "../lib/github-links";
import type { GithubLink } from "../lib/github-links";

export interface BaseFeedbackMenuItemsProps {
  /** Offers "Share feedback": only where a send can succeed */
  canShare: boolean;
  onShare: () => void;
  onGithub: (link: GithubLink) => void;
}

/**
 * The feedback entries, for a menu someone else owns (the account menu).
 * "Suggest an idea" is the form's alone: the prototype's menu has no such row
 */
export const BaseFeedbackMenuItems = ({
  canShare,
  onShare,
  onGithub,
}: BaseFeedbackMenuItemsProps) => (
  <>
    {canShare && (
      <DropdownMenuItem onSelect={onShare}>
        <MessageCircle /> Share feedback
      </DropdownMenuItem>
    )}
    <DropdownMenuItem asChild>
      <a
        href={GITHUB_LINKS.bug}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onGithub("bug")}
      >
        <Bug /> Report a bug
        <ArrowUpRight aria-hidden className="ml-auto text-muted-foreground" />
      </a>
    </DropdownMenuItem>
  </>
);
