import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FC, ReactNode, RefObject } from "react";
import {
  Check,
  ChevronDown,
  Ellipsis,
  Folder,
  Pin,
  Terminal,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  EditorTab,
  EditorTabLabel,
  EditorTabs,
  EditorTabTrigger,
} from "@/shared/ui/editor-tabs";
import { Kbd } from "@/shared/ui/kbd";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import type { TreeSource } from "../model/telemetry";
import type { TreeRow } from "../model/tree";
import BaseFileTreeList from "./BaseFileTreeList";

/** The open tab on the code's own ground, without the coloured bar */
const TAB = "before:hidden data-active:bg-(--code-ground)";

/**
 * What opens the tree is marked, so a press on it while the popover is up
 * is not also a press outside it, which would close it and open it again
 */
const FILES_TOGGLE = "data-files-toggle";

export interface BaseWorkspaceHeadProps {
  /** The tabs, in the project's order, by path */
  tabs: string[];
  /** The open file's path, or null when no file is open */
  active: string | null;
  onOpen: (path: string) => void;
  tree: {
    /** The popover is up */
    open: boolean;
    /** The tree is docked beside the editor */
    docked: boolean;
    /** Wide enough to dock: the pin shows */
    canDock: boolean;
    rows: TreeRow[];
    /** Open or close the popover; a docked tree is undocked instead */
    onToggle: (via: TreeSource) => void;
    onClose: () => void;
    onPick: (path: string) => void;
    onDock: () => void;
  };
  /** The Call button, once the program is deployed (task 4.4) */
  call?: ReactNode;
  terminal: { open: boolean; onToggle: () => void };
  /** "⌘E" on a Mac, "Ctrl E" elsewhere */
  filesKey: string;
  /** "⌘J" on a Mac, "Ctrl J" elsewhere */
  terminalKey: string;
}

/** Whether the strip hides tabs past its left or right edge */
const useEdges = (strip: RefObject<HTMLDivElement | null>, count: number) => {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) =>
        e.left === left && e.right === right ? e : { left, right }
      );
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [strip, count]);
  return edges;
};

/**
 * A fade over the last 2rem at each edge that hides tabs. A mask reads only
 * alpha, so the opaque stops take the text colour: any opaque colour would do
 */
const fade = (edges: { left: boolean; right: boolean }) => {
  if (!edges.left && !edges.right) return undefined;
  const mask = `linear-gradient(to right, ${
    edges.left ? "transparent, currentColor 2rem" : "currentColor"
  }, ${
    edges.right ? "currentColor calc(100% - 2rem), transparent" : "currentColor"
  })`;
  return { maskImage: mask, WebkitMaskImage: mask } as CSSProperties;
};

const baseName = (path: string) => path.split("/").pop() ?? path;

/** A tool at the head's right end: its glyph alone, the name and key in the tip */
const Tool: FC<{
  label: string;
  keys: string;
  icon: ReactNode;
  pressed: boolean;
  onClick: () => void;
  files?: boolean;
}> = ({ label, keys, icon, pressed, onClick, files = false }) => (
  <Tooltip delayDuration={300}>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        {...(files ? { [FILES_TOGGLE]: "" } : {})}
        className={cn(
          "rounded-lg text-muted-foreground hover:text-foreground [&_svg]:size-[18px]! [&_svg]:stroke-[1.5]",
          pressed && "bg-surface-hover text-foreground"
        )}
      >
        {icon}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">
      {label}
      <Kbd className="ml-1.5">{keys}</Kbd>
    </TooltipContent>
  </Tooltip>
);

/**
 * The workspace head (prototype `WorkspaceTabs`): the file tabs, which never
 * close, then at the right end the Call slot, Files and Terminal. Files is
 * the tree's one way in: a popover off the tabs whose pin docks it beside
 * the editor. No Build, Deploy or Run here; those live in the chat.
 */
const BaseWorkspaceHead: FC<BaseWorkspaceHeadProps> = ({
  tabs,
  active,
  onOpen,
  tree,
  call,
  terminal,
  filesKey,
  terminalKey,
}) => {
  const strip = useRef<HTMLDivElement>(null);
  const chevron = useRef<HTMLButtonElement>(null);
  const escaped = useRef(false);
  const edges = useEdges(strip, tabs.length);
  const shown = tree.open || tree.docked;

  // The open tab is always in view, and so it stays as the strip narrows
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const bring = () =>
      el
        .querySelector<HTMLElement>("[data-active]")
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    bring();
    const ro = new ResizeObserver(bring);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, tabs.length]);

  return (
    <div
      data-testid="tutorial-workspace-head"
      className="flex h-11 shrink-0 items-stretch border-b border-border bg-surface-base"
    >
      <Popover
        open={tree.open}
        onOpenChange={(open) => {
          if (!open) tree.onClose();
        }}
      >
        <PopoverAnchor asChild>
          <EditorTabs
            ref={strip}
            style={fade(edges)}
            className="h-full min-w-0 flex-1 border-b-0!"
          >
            {tabs.map((tab) => (
              <EditorTab
                key={tab}
                active={tab === active}
                className={cn(TAB, "shrink-0 px-0!")}
              >
                <EditorTabTrigger
                  className={cn("gap-1.5 px-3", tab === active && "pr-0.5")}
                  onClick={() => onOpen(tab)}
                >
                  <EditorTabLabel>{baseName(tab)}</EditorTabLabel>
                </EditorTabTrigger>
                {/* The tree from beside the open file's name, to step back
                    from client.ts to lib.rs; it turns over while shown */}
                {tab === active && (
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <button
                        ref={chevron}
                        type="button"
                        aria-label="Files"
                        aria-haspopup="dialog"
                        aria-expanded={shown}
                        onClick={() => tree.onToggle("tab")}
                        {...{ [FILES_TOGGLE]: "" }}
                        className="mr-1.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            "size-3.5 transition-transform duration-150 ease-standard motion-reduce:transition-none",
                            shown && "rotate-180"
                          )}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Files
                      <Kbd className="ml-1.5">{filesKey}</Kbd>
                    </TooltipContent>
                  </Tooltip>
                )}
              </EditorTab>
            ))}
          </EditorTabs>
        </PopoverAnchor>
        {/* A sheet out of the workspace's corner: flush under the head's
            line, square there, rounded only at its free corner */}
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={1}
          aria-label="Files"
          className="relative w-64 gap-0 rounded-none rounded-br-lg border-r border-b border-border bg-surface-base p-1.5 ring-0 data-open:zoom-in-100 data-closed:zoom-out-100"
          onOpenAutoFocus={(e) => {
            // Focus lands on the open file, not on the pin
            e.preventDefault();
            (e.currentTarget as HTMLElement)
              .querySelector<HTMLElement>('[aria-selected="true"]')
              ?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={() => {
            escaped.current = true;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (escaped.current) chevron.current?.focus();
            escaped.current = false;
          }}
          onInteractOutside={(e) => {
            if (
              e.target instanceof Element &&
              e.target.closest(`[${FILES_TOGGLE}]`)
            ) {
              e.preventDefault();
            }
          }}
        >
          {tree.canDock && (
            <div className="absolute top-1.5 right-1.5 z-10">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Dock beside the editor"
                    onClick={tree.onDock}
                    className="rounded-md text-muted-foreground hover:text-foreground [&_svg]:size-4! [&_svg]:stroke-[1.5]"
                  >
                    <Pin />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Dock beside the editor
                </TooltipContent>
              </Tooltip>
            </div>
          )}
          <BaseFileTreeList rows={tree.rows} onPick={tree.onPick} />
        </PopoverContent>
      </Popover>
      {/* Every tab, when the strip cannot show them all */}
      {(edges.left || edges.right) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`All tabs, ${tabs.length}`}
              className="my-auto ml-0.5 shrink-0 rounded-lg text-muted-foreground hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground [&_svg]:size-[18px]! [&_svg]:stroke-[1.5]"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 min-w-56">
            <DropdownMenuLabel className="text-caption text-muted-foreground">
              Open tabs · {tabs.length}
            </DropdownMenuLabel>
            {tabs.map((tab) => {
              const at = tab.lastIndexOf("/");
              return (
                <DropdownMenuItem
                  key={tab}
                  onSelect={() => onOpen(tab)}
                  className="gap-2"
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 shrink-0",
                      tab === active ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate font-mono text-[0.8125rem]">
                    {tab.slice(at + 1)}
                  </span>
                  {at > 0 && (
                    <span className="ml-auto pl-3 text-caption text-muted-foreground">
                      {tab.slice(0, at)}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 pr-2">
        {call && (
          <>
            {call}
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          </>
        )}
        <Tool
          label="Files"
          keys={filesKey}
          icon={<Folder />}
          pressed={shown}
          onClick={() => tree.onToggle("button")}
          files
        />
        <Tool
          label="Terminal"
          keys={terminalKey}
          icon={<Terminal />}
          pressed={terminal.open}
          onClick={terminal.onToggle}
        />
      </div>
    </div>
  );
};

export default BaseWorkspaceHead;
