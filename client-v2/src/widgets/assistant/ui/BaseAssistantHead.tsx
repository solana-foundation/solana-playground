import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
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

/**
 * Forget key in More: `none` while no backend holding the user's key is
 * connected (the item is not shown), `busy` while a turn runs (shown
 * disabled, since the turn is using the key)
 */
export type ForgetKey = "none" | "ready" | "busy";

export interface BaseAssistantHeadProps {
  /** The open project's name */
  title: string;
  /** Opens Sources and tools in place of the conversation */
  onSources(): void;
  /** Opens Connect a model */
  onConnect(): void;
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
 * The assistant's head: the project's name, then More, Widen and Hide.
 *
 * More's items take S and K while it is open. The shortcuts are shown with
 * `DropdownMenuShortcut`, which only draws them, and the menu's typeahead
 * would take S but never K ("Connect…"), so the keys are read here.
 */
export function BaseAssistantHead({
  title,
  onSources,
  onConnect,
  focusPicked,
  wide,
  onWiden,
  onHide,
  canWiden,
  forgetKey,
  onForgetKey,
}: BaseAssistantHeadProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  // A picked item may open something (Sources in place of the chat, Connect
  // a model over it), so once the menu has closed (after its exit animation)
  // focus goes there (`focusPicked`), not back to More, which would blur
  // whatever the user reached in the meantime:
  // a select opened in that window shut. A dismissal (Escape, a click outside)
  // still returns focus to More.
  const picked = useRef(false);

  const pick = (action: () => void) => {
    picked.current = true;
    setMoreOpen(false);
    action();
  };

  /** S and K with no modifier; anything else stays the menu's */
  const onMenuKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const shortcuts: Record<string, () => void> = {
      s: onSources,
      k: onConnect,
    };
    const action = shortcuts[event.key.toLowerCase()];
    if (!action) return;
    // Keeps the menu's own typeahead from also acting on the key
    event.preventDefault();
    pick(action);
  };

  const widenLabel = wide ? "Narrow the assistant" : "Widen the assistant";

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border py-1.5 pr-1.5 pl-3">
      <h2
        className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
        title={title}
      >
        {title}
      </h2>
      <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More">
            <EllipsisVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-auto min-w-48"
          onKeyDown={onMenuKey}
          onCloseAutoFocus={(event) => {
            const wasPicked = picked.current;
            picked.current = false;
            if (wasPicked && focusPicked()) event.preventDefault();
          }}
        >
          <DropdownMenuItem onSelect={() => pick(onSources)}>
            <MenuItemText>Sources and tools</MenuItemText>
            <DropdownMenuShortcut>S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick(onConnect)}>
            <MenuItemText>Connect a model…</MenuItemText>
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
