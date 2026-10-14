import type { CSSProperties, Ref } from "react";
import { Bug, Lightbulb, MessageCircle, MessageSquare } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { GITHUB_LINKS } from "../lib/github-links";
import type { GithubLink } from "../lib/github-links";

export interface BaseFeedbackWidgetProps {
  /** Offers "Share feedback": only where a send can succeed */
  canShare: boolean;
  /** A send is in flight; the form may be closed, so the trigger shows it */
  sending: boolean;
  onShare: () => void;
  onGithub: (link: GithubLink) => void;
  triggerRef?: Ref<HTMLButtonElement>;
  /** The menu portals outside the app wrapper that sets the font, so it is given here */
  font?: CSSProperties;
}

/** The trigger and its menu, placed by the caller */
export const BaseFeedbackWidget = ({
  canShare,
  sending,
  onShare,
  onGithub,
  triggerRef,
  font,
}: BaseFeedbackWidgetProps) => (
  // `relative` anchors the halo; the navigation's footer places the trigger, as the prototype's account menu holds "Report a bug"
  <div className="relative rounded-full gradient-stroke shadow-lg [--stroke-fill:var(--surface-panel)]">
    {sending && (
      // A halo behind the button, so a send behind a closed form is seen without looking for the spinner
      <span
        aria-hidden="true"
        data-slot="feedback-pulse"
        className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-primary/40 motion-safe:animate-ping"
      />
    )}
    <DropdownMenu>
      <DropdownMenuTrigger asChild ref={triggerRef}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Feedback"
          aria-busy={sending || undefined}
          // The ghost variant sets no background, and without preflight the browser's grey shows
          className="rounded-full bg-transparent"
        >
          {sending ? (
            <Spinner aria-label="Sending feedback" />
          ) : (
            <MessageSquare />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-auto"
        style={font}
      >
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
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
