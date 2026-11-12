import { Pin, PinOff } from "lucide-react";
import type { FC } from "react";

import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/**
 * The tree's shell, one for a tutorial's workspace and a project's work
 * column: the pin that docks the tree beside the editor, the unpin that puts
 * it back in its dropdown, the dropdown's sheet and the width that allows a
 * dock. In `shared` because both trees live in widgets
 * (`tutorial-workspace`, `layout-shell`), which may not import each other.
 * Only the shell is shared: each widget keeps its own tree body.
 */

/** The code area is wide enough to dock the tree beside the editor from here */
export const DOCK_MIN_PX = 1100;

/** Whether a code area this wide (px) can hold a docked tree */
export const canDockAt = (width: number) => width >= DOCK_MIN_PX;

/**
 * What opens the tree is marked, so a press on it while the dropdown is up
 * is not also a press outside it, which would close it and open it again
 */
export const FILES_TOGGLE = "data-files-toggle";

/**
 * The dropdown's sheet, out of the code area's corner: flush under the
 * head's line, square there, rounded only at its free corner
 */
export const TREE_SHEET =
  "relative w-64 gap-0 rounded-none rounded-br-lg border-r border-b border-border bg-surface-base p-1.5 ring-0 data-open:zoom-in-100 data-closed:zoom-out-100";

/**
 * Whether a press or focus outside the dropdown belongs to it after all: on
 * what opens it, or in a menu or dialog it opened, which portal out of it
 * (a file's context menu, its Rename and Delete dialogs)
 */
export const keepsTreeOpen = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    `[${FILES_TOGGLE}], [role="menu"], [role="dialog"], [role="alertdialog"]`
  ) !== null;

/** «Dock beside the editor», at the dropdown's top right */
export const DockPin: FC<{ onDock: () => void }> = ({ onDock }) => (
  <div className="absolute top-1.5 right-1.5 z-10">
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dock beside the editor"
          onClick={onDock}
          className="rounded-md text-muted-foreground hover:text-foreground [&_svg]:size-4! [&_svg]:stroke-[1.5]"
        >
          <Pin />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Dock beside the editor</TooltipContent>
    </Tooltip>
  </div>
);

/** "Undock the files", at the docked tree's top right */
export const UndockPin: FC<{ onUndock: () => void }> = ({ onUndock }) => (
  <div className="absolute top-1.5 right-1.5 z-10">
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Undock the files"
          onClick={onUndock}
          className="text-muted-foreground"
        >
          <PinOff />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Undock</TooltipContent>
    </Tooltip>
  </div>
);
