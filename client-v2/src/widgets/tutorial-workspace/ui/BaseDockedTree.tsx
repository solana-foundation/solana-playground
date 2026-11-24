import type { FC } from "react";

import { UndockPin } from "@/shared/lib/tree-dock";

import type { TreeRow } from "../model/tree";
import BaseFileTreeList from "./BaseFileTreeList";

/** The docked tree's width, the editor giving way to it */
export const DOCKED_TREE_PX = 220;

export interface BaseDockedTreeProps {
  open: boolean;
  rows: TreeRow[];
  onPick: (path: string) => void;
  /** A doc page picked, by its Markdown file */
  onPickDoc: (file: string) => void;
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
  onPickDoc,
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
      <UndockPin onUndock={onUndock} />
      <div className="px-1.5 pb-2">
        <BaseFileTreeList rows={rows} onPick={onPick} onPickDoc={onPickDoc} />
      </div>
    </div>
  </div>
);

export default BaseDockedTree;
