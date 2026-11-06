import { CircleHelp, Ellipsis, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { MenuItemText } from "@/shared/ui/menu-extras";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export const DOCS_URL = "https://solana.com/docs";

/** A panel's toggle, here or in the editor head: whether it shows, and the click */
export interface BarToggle {
  open: boolean;
  onToggle: () => void;
}

export interface BaseStageBarProps {
  /** The project's name, shown while the assistant is hidden; null hides it */
  title: string | null;
  /**
   * The assistant's toggle: the panel's on a wide window, the Sheet's below;
   * null draws none, as over a page, which covers the assistant
   */
  assistant: BarToggle | null;
  /**
   * The key the assistant's hint names, Ctrl+R unless given; null names
   * none, as under Home, where the shell's keys do nothing
   */
  assistantKey?: string | null;
  /**
   * The page's own actions for the open project, drawn before the toggles,
   * as the header's Share. Here, not in the assistant's head, so they stay
   * while the assistant is folded
   */
  actions?: ReactNode;
}

/**
 * The head control, as Claude's app draws its corner: a 32 px square, radius
 * 8, a thin 18 px icon, muted until hovered or while its column shows, when
 * the square takes the accent fill. Its name is the tooltip
 */
const BAR_CONTROL =
  "h-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-[18px] [&_svg]:stroke-[1.6]";

/** An icon button with its label as the tooltip, as the assistant's head draws them */
const BarButton = ({
  label,
  hint,
  expanded,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  expanded?: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(BAR_CONTROL, "size-8")}
        aria-label={label}
        aria-expanded={expanded}
        onClick={onClick}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{hint}</TooltipContent>
  </Tooltip>
);

/** The assistant's toggle, named by what a click does */
const AssistantToggle = ({
  assistant,
  assistantKey,
}: {
  assistant: BarToggle;
  assistantKey: string | null;
}) => {
  const label = assistant.open ? "Hide the assistant" : "Expand assistant";
  return (
    <BarButton
      label={label}
      hint={assistantKey === null ? label : `${label} (${assistantKey})`}
      // Whether the pane is open: the ghost button draws `aria-expanded`
      // filled, the prototype's look for a shown assistant. Not `aria-pressed`, which is for a toggle whose
      // label stays the same, and this label changes with each click
      expanded={assistant.open}
      onClick={assistant.onToggle}
    >
      <MessageSquare aria-hidden="true" />
    </BarButton>
  );
};

/**
 * The 44 px bar over the files column and the stage (design.md, "Frame chrome
 * (5.25)"): the project's name while the assistant is hidden, then one row
 * of icons, as Claude's corner: the page's actions (Share), the assistant's
 * toggle and More, which holds the documentation. The files toggle lives in
 * the editor head (`BaseEditorHead`), beside the terminal's. The assistant's
 * toggle is named apart from the head's "Collapse assistant", so
 * each name stays one button.
 */
const BaseStageBar = ({
  title,
  assistant,
  assistantKey = "Ctrl+R",
  actions,
}: BaseStageBarProps) => {
  return (
    <div
      data-slot="stage-bar"
      className="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3"
    >
      <span
        className="min-w-0 flex-1 truncate text-sm font-headline text-muted-foreground"
        title={title ?? undefined}
      >
        {title}
      </span>
      <div className="flex items-center gap-1">
        {actions}
        {assistant && (
          <AssistantToggle assistant={assistant} assistantKey={assistantKey} />
        )}
        {/* What is rarely needed waits behind More, as in Claude's corner */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(BAR_CONTROL, "size-8")}
                  // Apart from the assistant head's "More", so each name
                  // stays one button
                  aria-label="More options"
                >
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>More</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-auto min-w-48">
            <DropdownMenuItem asChild>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Documentation"
              >
                <CircleHelp aria-hidden="true" />
                <MenuItemText>Solana documentation</MenuItemText>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export default BaseStageBar;
