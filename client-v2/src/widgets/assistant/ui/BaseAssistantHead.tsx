import {
  EllipsisVertical,
  FoldHorizontal,
  PanelLeftClose,
  UnfoldHorizontal,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { MenuItemText } from "@/shared/ui/menu-extras";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { headText } from "../model/head-label";
import type { HeadLabel } from "../model/head-label";
import { OverflowTooltip } from "./OverflowTooltip";
import { usePickedMenu } from "./use-picked-menu";

/**
 * Forget key in More: `none` while no backend holding the user's key is
 * connected (the item is not shown), `busy` while a turn runs (shown
 * disabled, since the turn is using the key)
 */
export type ForgetKey = "none" | "ready" | "busy";

export interface BaseAssistantHeadProps {
  /** The model in use, in the head's words (`headLabel`) */
  label: HeadLabel;
  /** Opens Sources and tools in place of the conversation */
  onSources(): void;
  /** Opens Connect a model */
  onConnect(): void;
  /** Connect's item, from `connectLabel` in `model/connection` */
  connectLabel: string;
  /**
   * Called once More's menu has closed on a picked item: gives focus to what
   * the pick opened. `false` when nothing took it, and More takes it back.
   */
  focusPicked(): boolean;
  /** The panel is widened to its maximum */
  wide: boolean;
  /** Widens the panel, or narrows it back when `wide` */
  onWiden(): void;
  /** Folds the panel, or closes the Sheet */
  onHide(): void;
  /** Widen is offered: not in the Sheet, which has no width to change */
  canWiden: boolean;
  forgetKey: ForgetKey;
  /** Drops the backend and the key this tab holds */
  onForgetKey(): void;
}

/**
 * The assistant's head: the model in use, then More, Widen and Hide. Only
 * the model's name is cut when the column is narrow; the words around it
 * stay, and the cut name shows whole on hover (`OverflowTooltip`).
 *
 * More's items take S and K while it is open (`usePickedMenu`); the shortcuts
 * are shown with `DropdownMenuShortcut`, which only draws them.
 */
export function BaseAssistantHead({
  label,
  onSources,
  onConnect,
  connectLabel,
  focusPicked,
  wide,
  onWiden,
  onHide,
  canWiden,
  forgetKey,
  onForgetKey,
}: BaseAssistantHeadProps) {
  const more = usePickedMenu(focusPicked, { s: onSources, k: onConnect });
  const { pick } = more;

  const widenLabel = wide ? "Narrow the assistant" : "Widen the assistant";

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3">
      {/* Named whole: the name is computed per span, and would lose the
          spaces between the parts */}
      <h2
        className="flex min-w-0 flex-1 text-sm font-medium whitespace-pre text-foreground"
        aria-label={headText(label)}
      >
        {label.kind === "plain" ? (
          <span className="truncate">{label.text}</span>
        ) : (
          <>
            {label.lead && <span className="shrink-0">{label.lead}</span>}
            {/* Hover only: the head is no tab stop, and the composer's model
                button shows the same name on focus */}
            <OverflowTooltip label={label.model}>
              <span data-overflow="" className="min-w-0 truncate">
                {label.model}
              </span>
            </OverflowTooltip>
            <span className="shrink-0">{label.tail}</span>
          </>
        )}
      </h2>
      <DropdownMenu open={more.open} onOpenChange={more.setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More">
            <EllipsisVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-auto min-w-48"
          onKeyDown={more.onKeyDown}
          onCloseAutoFocus={more.onCloseAutoFocus}
        >
          <DropdownMenuItem onSelect={() => pick(onSources)}>
            <MenuItemText>Sources and tools</MenuItemText>
            <DropdownMenuShortcut>S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick(onConnect)}>
            <MenuItemText>{connectLabel}</MenuItemText>
            <DropdownMenuShortcut>K</DropdownMenuShortcut>
          </DropdownMenuItem>
          {forgetKey === "ready" && (
            <DropdownMenuItem onSelect={() => pick(onForgetKey)}>
              <MenuItemText>Forget key</MenuItemText>
            </DropdownMenuItem>
          )}
          {forgetKey === "busy" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <DropdownMenuItem disabled>
                    <MenuItemText>Forget key</MenuItemText>
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">
                Finish this turn first
              </TooltipContent>
            </Tooltip>
          )}
          {/* A disabled item takes no pointer events, so the tooltip hangs
              on a wrapper. Clearing waits on the cross-device clear
              (HOO-1741): clearing only what is shown would come back from
              another device. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem disabled>
                  <MenuItemText>Clear conversation</MenuItemText>
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">Coming soon</TooltipContent>
          </Tooltip>
        </DropdownMenuContent>
      </DropdownMenu>
      {canWiden && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={widenLabel}
              onClick={onWiden}
            >
              {wide ? (
                <FoldHorizontal aria-hidden="true" />
              ) : (
                <UnfoldHorizontal aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{widenLabel}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse assistant"
            onClick={onHide}
          >
            <PanelLeftClose aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Collapse assistant</TooltipContent>
      </Tooltip>
    </div>
  );
}
