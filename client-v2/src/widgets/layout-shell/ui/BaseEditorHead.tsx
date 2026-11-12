import { Folder, Terminal } from "lucide-react";
import type { ReactNode, RefCallback } from "react";

import {
  DockPin,
  FILES_TOGGLE,
  keepsTreeOpen,
  TREE_SHEET,
} from "@/shared/lib/tree-dock";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import type { BarToggle } from "./BaseStageBar";

/** The project tree's dropdown under the head, the tree not docked */
export interface EditorHeadTree {
  /** The dropdown is up; `body` is given exactly while it is */
  open: boolean;
  /** The code area is wide enough to dock: the pin shows */
  canDock: boolean;
  /** Escape or a press outside closed it */
  onClose: () => void;
  /** «Dock beside the editor» */
  onDock: () => void;
  /** The tree, mounted only while the dropdown is up */
  body: ReactNode;
}

export interface BaseEditorHeadProps {
  /**
   * "Files": pressed while the tree shows, docked or as the dropdown; its
   * click undocks a docked tree, else opens or closes the dropdown
   */
  files: BarToggle;
  /** The tree's dropdown, anchored under the head */
  tree?: EditorHeadTree;
  /** The console's toggle */
  terminal: BarToggle;
  /**
   * Whether the tab row shows: only on the Write stage, since `Write` stays
   * mounted, hidden, on the others and its row would linger here
   */
  showTabs: boolean;
  /** Receives the element the tab row portals into (`editorHeadHost`) */
  hostRef: RefCallback<HTMLDivElement>;
  /** The files column's key as the user presses it (`keyLabel(FILES_KEY, os)`) */
  filesKey: string;
  /** The console's key as the user presses it (`keyLabel(CONSOLE_KEY, os)`) */
  terminalKey: string;
  /**
   * The bar's icons (`BaseBarControls`) after the toggles: in an open project
   * the head is the work's one bar, so Share and More live here
   */
  controls?: ReactNode;
}

/**
 * A panel's toggle: an 18 px icon in a 32 px square, radius 8; its label
 * stays the same, so it says open with `aria-pressed`, drawn as the hover fill
 */
const HeadToggle = ({
  id,
  label,
  hint,
  toggle,
  opensTree = false,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  toggle: BarToggle;
  /** It opens the tree's dropdown, so a press on it is not outside that */
  opensTree?: boolean;
  children: ReactNode;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        id={id}
        variant="ghost"
        size="icon-sm"
        className="size-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-4.5"
        aria-label={label}
        aria-pressed={toggle.open}
        onClick={toggle.onToggle}
        {...(opensTree ? { [FILES_TOGGLE]: "" } : {})}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{hint}</TooltipContent>
  </Tooltip>
);

/**
 * The 44 px head over the files column and the stage (DES-205): the editor's
 * tab row on its left, the Files and Terminal toggles on its right. It sits
 * outside the files/center group, so opening the tree moves nothing in it.
 * An undocked tree drops under it as the tutorial's does: the same sheet,
 * with the pin that docks it while the code area is wide enough.
 */
const BaseEditorHead = ({
  files,
  tree,
  terminal,
  showTabs,
  hostRef,
  filesKey,
  terminalKey,
  controls,
}: BaseEditorHeadProps) => (
  <Popover
    open={tree?.open ?? false}
    onOpenChange={(open) => {
      if (!open) tree?.onClose();
    }}
  >
    <PopoverAnchor asChild>
      {/* 1 px on the right: the 32 px toggles hold their 18 px icon 7 px in,
        so the last icon ends 8 px from the edge, under the stepper's right edge */}
      <div
        id="editor-head"
        data-slot="editor-head"
        className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-surface-base pr-px"
      >
        {/* No display class of its own, so `hidden` takes it off the page. The
      row fills the head: the head draws the fill and the bottom line, so the
      row's own height and line would stack a second one under it. `#tabs` is
      `PgView.ids.TABS`, the id `components/Tabs` gives the row */}
        <div
          ref={hostRef}
          hidden={!showTabs}
          className="min-w-0 flex-1 self-stretch [&>#tabs]:h-full [&>#tabs]:border-b-0"
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <HeadToggle
            id="editor-head-files"
            label="Files"
            hint={`Files (${filesKey})`}
            toggle={files}
            opensTree
          >
            <Folder aria-hidden="true" />
          </HeadToggle>
          <HeadToggle
            id="editor-head-terminal"
            label="Terminal"
            hint={`Terminal (${terminalKey})`}
            toggle={terminal}
          >
            <Terminal aria-hidden="true" />
          </HeadToggle>
          {controls}
        </div>
      </div>
    </PopoverAnchor>
    {/* The tree keeps its own scroll and its "+ New file" at the foot, so the
      sheet gives it a height and no padding of its own */}
    <PopoverContent
      side="bottom"
      align="start"
      sideOffset={0}
      aria-label="Files"
      className={cn(TREE_SHEET, "h-[min(32rem,70dvh)] overflow-hidden p-0")}
      // Focus stays where it was: the tree's rows take it on a click
      onOpenAutoFocus={(e) => e.preventDefault()}
      onInteractOutside={(e) => {
        if (keepsTreeOpen(e.target)) e.preventDefault();
      }}
    >
      {tree?.canDock && <DockPin onDock={tree.onDock} />}
      {tree?.body}
    </PopoverContent>
  </Popover>
);

export default BaseEditorHead;
