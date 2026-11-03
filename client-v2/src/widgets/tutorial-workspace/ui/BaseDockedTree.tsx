import type { FC } from "react";
import { PinOff } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import type { TreeRow } from "../model/tree";
import BaseFileTreeList from "./BaseFileTreeList";

/** The docked tree's width, the editor giving way to it */
export const DOCKED_TREE_PX = 220;

export interface BaseDockedTreeProps {
  open: boolean;
  rows: TreeRow[];
  onPick: (path: string) => void;
  onUndock: () => void;
}

/**
 * The tree docked beside the editor (prototype `DockedTree`): laid out at
 * its width and clipped while it opens, so nothing rewraps. The unpin puts
 * it back in the popover.
 */
const BaseDockedTree: FC<BaseDockedTreeProps> = ({
  open,
  rows,
  onPick,
  onUndock,
}) => (
  <div
    data-testid="tutorial-docked-tree"
    aria-hidden={!open || undefined}
    inert={!open}
    className="shrink-0 overflow-hidden border-border bg-surface-base transition-[width] duration-200 ease-standard motion-reduce:transition-none"
    style={{
      width: open ? DOCKED_TREE_PX : 0,
      borderRightWidth: open ? 1 : 0,
    }}
  >
    <div className="relative pt-1.5" style={{ width: DOCKED_TREE_PX - 1 }}>
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
      <div className="px-1.5 pb-2">
        <BaseFileTreeList rows={rows} onPick={onPick} />
      </div>
    </div>
  </div>
);

export default BaseDockedTree;
