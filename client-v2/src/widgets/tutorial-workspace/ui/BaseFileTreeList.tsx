import type { FC, KeyboardEvent } from "react";
import { ChevronDown, FileCode } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { moveFocus } from "../model/tree";
import type { TreeRow } from "../model/tree";

/** One row's shape, the navigation's: 28 px, 13 px, the glyph in a 16 px box */
const ROW =
  "flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[0.8125rem] whitespace-nowrap outline-none transition-colors duration-100 hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-purple motion-reduce:transition-none";

/** A level's indent: a folder's caret (12) and the gap after it (8) */
const STEP_PX = 20;

const indentOf = (depth: number) => ({
  paddingLeft: `${8 + depth * STEP_PX}px`,
});

type FileRow = Extract<TreeRow, { kind: "file" }>;
type FolderRow = Extract<TreeRow, { kind: "folder" }>;

/** The rows as the tree nests them: each folder with its files, then the root's */
const groups = (rows: TreeRow[]) => {
  const out: { folder: FolderRow | null; files: FileRow[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (row.kind === "folder") out.push({ folder: row, files: [] });
    else if (row.depth > 0 && last?.folder) last.files.push(row);
    else out.push({ folder: null, files: [row] });
  }
  return out;
};

export interface BaseFileTreeListProps {
  rows: TreeRow[];
  onPick: (path: string) => void;
}

/**
 * The tutorial's files by folder (prototype `FileTreeList`). The open file
 * is marked, the live step's file carries a dot, and a file a later step
 * creates says so and cannot be picked. ↑ and ↓ move between the files;
 * Enter is the row's own button. A folder is an expanded treeitem owning a
 * group of its files, so the tree holds treeitems only.
 */
const BaseFileTreeList: FC<BaseFileTreeListProps> = ({ rows, onPick }) => {
  // Every row, folders' labels included, in `rows`' order: `moveFocus` counts
  // in that order and never lands on a label
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const stops = [
      ...e.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]"),
    ];
    const at = stops.findIndex((b) => b === document.activeElement);
    const to = moveFocus(rows, at, e.key);
    if (to === null) return;
    e.preventDefault();
    stops[to]?.focus();
  };

  const fileRow = (row: FileRow) => {
    const waiting = row.waiting !== null;
    return (
      <button
        key={row.path}
        type="button"
        role="treeitem"
        data-tree-row
        data-file={row.path}
        aria-selected={row.open}
        disabled={waiting}
        // The docked tree is narrow enough to cut the note short
        title={waiting ? `Created in step ${row.waiting}` : undefined}
        onClick={() => onPick(row.path)}
        style={indentOf(row.depth)}
        className={cn(
          ROW,
          "relative disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
          row.open
            ? "bg-surface-hover text-foreground"
            : "text-muted-foreground"
        )}
      >
        <FileCode
          aria-hidden="true"
          className="size-[15px] shrink-0 text-subtle"
        />
        {/* The name keeps its letters; the note beside it gives way */}
        <span className="max-w-[60%] shrink-0 truncate">{row.name}</span>
        {/* Not there yet, said once in words: no fade, no lock */}
        {waiting && (
          <span className="ml-auto min-w-0 truncate pl-3 text-caption text-muted-foreground">
            Created in step {row.waiting}
          </span>
        )}
        {row.live && (
          <span
            role="img"
            aria-label="This step's file"
            className="ml-auto size-1.5 shrink-0 rounded-full bg-brand-purple"
          />
        )}
      </button>
    );
  };

  return (
    <div
      role="tree"
      aria-label="Files"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-px"
    >
      {groups(rows).map((group) =>
        group.folder ? (
          <div
            key={`folder:${group.folder.name}`}
            role="treeitem"
            aria-expanded="true"
            aria-label={group.folder.name}
            className="flex flex-col gap-px"
          >
            <div
              data-tree-row
              aria-hidden="true"
              style={indentOf(group.folder.depth)}
              className={cn(
                ROW,
                "cursor-default text-muted-foreground hover:bg-transparent hover:text-muted-foreground"
              )}
            >
              <ChevronDown className="size-3 shrink-0" />
              {group.folder.name}
            </div>
            <div role="group" className="flex flex-col gap-px">
              {group.files.map(fileRow)}
            </div>
          </div>
        ) : (
          group.files.map(fileRow)
        )
      )}
    </div>
  );
};

export default BaseFileTreeList;
