import { Folder, Plus, Terminal } from "lucide-react";
import type { ReactNode, RefCallback } from "react";

import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import type { BarToggle } from "./BaseStageBar";

export interface BaseEditorHeadProps {
  /** The files column's toggle */
  files: BarToggle;
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
  /**
   * The open project's name, set while the assistant is folded: its head
   * names the project, so with it away the work would be unnamed
   */
  title?: string;
  /** New file, the + after the tabs; drawn with the tab row */
  onNewFile?: () => void;
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
  children,
}: {
  id: string;
  label: string;
  hint: string;
  toggle: BarToggle;
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
 */
const BaseEditorHead = ({
  files,
  terminal,
  showTabs,
  hostRef,
  filesKey,
  terminalKey,
  controls,
  title,
  onNewFile,
}: BaseEditorHeadProps) => (
  // 1 px on the right: the 32 px toggles hold their 18 px icon 7 px in, so
  // the last icon ends 8 px from the edge, under the stepper's right edge
  <div
    id="editor-head"
    data-slot="editor-head"
    className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-surface-base pr-px"
  >
    {/* No display class of its own, so `hidden` takes it off the page. The
      row fills the head: the head draws the fill and the bottom line, so the
      row's own height and line would stack a second one under it. `#tabs` is
      `PgView.ids.TABS`, the id `components/Tabs` gives the row */}
    {title && (
      // The assistant's head's type, so the name reads the same in either place
      <span className="max-w-48 shrink-0 truncate pr-2 pl-3 font-headline text-sm text-foreground">
        {title}
      </span>
    )}
    {/* Sized by its tabs, so the + follows the last one; it shrinks and
      scrolls once they outgrow the head */}
    <div
      ref={hostRef}
      hidden={!showTabs}
      className="min-w-0 self-stretch [&>#tabs]:h-full [&>#tabs]:border-b-0"
    />
    {showTabs && onNewFile && (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            id="editor-head-new-file"
            variant="ghost"
            size="icon-sm"
            className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-4.5"
            aria-label="New file"
            onClick={onNewFile}
          >
            <Plus aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New file</TooltipContent>
      </Tooltip>
    )}
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <HeadToggle
        id="editor-head-files"
        label="Files"
        hint={`Files (${filesKey})`}
        toggle={files}
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
);

export default BaseEditorHead;
