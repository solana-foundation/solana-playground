import {
  Ellipsis,
  FoldHorizontal,
  PanelLeftClose,
  PanelRightClose,
  UnfoldHorizontal,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { MenuItemText } from "@/shared/ui/menu-extras";
import { StatusDot } from "@/shared/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import type { KeyHold } from "../../../views/sidebar/assistant/model/types";
import type { AiOffReason } from "../model/ai-off";
import type { HeadLabel } from "../model/head-label";
import { headText } from "../model/head-label";
import { OverflowTooltip } from "./OverflowTooltip";
import { usePickedMenu } from "./use-picked-menu";

/** The head's icon buttons are thumb sized on a phone */
const THUMB = "max-md:size-11";

/**
 * The head's icon buttons drawn as the stage bar's (BaseStageBar's
 * `BAR_CONTROL`): a 32 px square, a thin 18 px icon, so the icons along the
 * top read as one set. TODO(design-system): a bar icon size in the kit's
 * Button, then drop this and the bar's copy
 */
const HEAD_CONTROL = cn(
  "size-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-[18px] [&_svg]:stroke-[1.6]",
  THUMB
);

/**
 * Delete my key in More, by `KeyHold`: not shown at `none`, shown disabled at
 * `busy`, since the turn is using the key
 */
export type DeleteKey = KeyHold;

/**
 * The head's word for each off reason, the status row's word for the same
 * state without its "AI ·", so one state keeps one word across the app:
 * "Off" for no model, and "Not responding", the app's word for a service
 * that does not answer while the browser is online. No model is a setup step, grey; a status
 * route that did not answer is a failure, red.
 */
const OFF_STATUS: Record<AiOffReason, { word: string; dot: "idle" | "error" }> =
  {
    "no-key": { word: "Off", dot: "idle" },
    "signed-out": { word: "Off", dot: "idle" },
    unreachable: { word: "Not responding", dot: "error" },
  };

export interface BaseAssistantHeadProps {
  /** The model in use, in the head's words (`headLabel`) */
  label: HeadLabel;
  /** Why no model can answer, while the composer's off row stands; `undefined` otherwise */
  off: AiOffReason | undefined;
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
  /**
   * The edge the assistant sits at, so Collapse points the way it goes: the
   * column folds left, the Sheet closes right
   */
  side: "left" | "right";
  deleteKey: DeleteKey;
  /** Drops the backend and the key this tab holds */
  onDeleteKey(): void;
}

/**
 * The assistant's head: the model in use, the off status while no model can
 * answer, then Widen, Hide and More. Only
 * the model's name is cut when the column is narrow; the words around it
 * stay, and the cut name shows whole on hover (`OverflowTooltip`).
 *
 * More's items take S and K while it is open (`usePickedMenu`). No hint shows
 * them: they work only inside the open menu, and drawn they read as global
 * shortcuts.
 */
export function BaseAssistantHead({
  label,
  off,
  onSources,
  onConnect,
  connectLabel,
  focusPicked,
  wide,
  onWiden,
  onHide,
  canWiden,
  side,
  deleteKey,
  onDeleteKey,
}: BaseAssistantHeadProps) {
  const more = usePickedMenu(focusPicked, { s: onSources, k: onConnect });
  const { pick } = more;

  const widenLabel = wide ? "Narrow the assistant" : "Widen the assistant";

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3">
      {/* Named whole: the name is computed per span, and would lose the
          spaces between the parts */}
      <h2
        className="flex min-w-0 flex-1 text-sm font-headline whitespace-pre text-foreground"
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
      {off && (
        <span
          id="assistant-status"
          className="inline-flex shrink-0 items-center gap-1.5 pr-1 text-caption text-muted-foreground"
        >
          <StatusDot variant={OFF_STATUS[off].dot} />
          {OFF_STATUS[off].word}
        </span>
      )}
      {canWiden && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={HEAD_CONTROL}
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
            className={HEAD_CONTROL}
            aria-label="Collapse assistant"
            onClick={onHide}
          >
            {side === "right" ? (
              <PanelRightClose aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Collapse assistant</TooltipContent>
      </Tooltip>
      {/* More last, at the edge, as the stage bar's and every toolbar's */}
      <DropdownMenu open={more.open} onOpenChange={more.setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className={HEAD_CONTROL}
            aria-label="More"
          >
            <Ellipsis aria-hidden="true" />
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
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick(onConnect)}>
            <MenuItemText>{connectLabel}</MenuItemText>
          </DropdownMenuItem>
          {deleteKey === "ready" && (
            <DropdownMenuItem onSelect={() => pick(onDeleteKey)}>
              <MenuItemText>Delete my key</MenuItemText>
            </DropdownMenuItem>
          )}
          {deleteKey === "busy" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <DropdownMenuItem disabled>
                    <MenuItemText>Delete my key</MenuItemText>
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
    </div>
  );
}
