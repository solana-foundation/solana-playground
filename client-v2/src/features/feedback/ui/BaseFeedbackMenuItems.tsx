import { ArrowUpRight, Bug, Lightbulb, MessageCircle } from "lucide-react";

import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { GITHUB_LINKS } from "../lib/github-links";
import type { GithubLink } from "../lib/github-links";

export interface BaseFeedbackMenuItemsProps {
  /** Offers "Share feedback": only where a send can succeed */
  canShare: boolean;
  onShare: () => void;
  onGithub: (link: GithubLink) => void;
}

/** The feedback entries, for a menu someone else owns (the account menu) */
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
        href={GITHUB_LINKS.idea}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onGithub("idea")}
      >
        <Lightbulb /> Suggest an idea
        <ArrowUpRight aria-hidden className="ml-auto text-muted-foreground" />
      </a>
    </DropdownMenuItem>
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
