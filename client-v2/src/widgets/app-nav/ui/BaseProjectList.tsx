import {
  Check,
  Copy,
  CornerDownLeft,
  Download,
  EllipsisVertical,
  Folder,
  GraduationCap,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import type { ComponentType, KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";

import type { SyncMarker } from "@/features/persistence";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/ui/empty";
import { Input } from "@/shared/ui/input";
import { MenuItemText } from "@/shared/ui/menu-extras";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/shared/ui/sidebar";
import { StatusDot } from "@/shared/ui/status-dot";

import type { ProjectAction } from "../model/project-action";
import type { LessonProgress, ProjectEntry } from "../model/project-entries";

type Via = "click" | "key";

export interface BaseProjectListProps {
  /** Projects and started lessons, in one list as the prototype draws it */
  projects: ProjectEntry[];
  /** The names are still being read from browser storage: skeleton rows, no entries */
  loading: boolean;
  /** The open workspace's name, or `undefined` when none is open */
  current: string | undefined;
  /** The entry whose row is the rename field, or `undefined` */
  renaming: string | undefined;
  /** What is wrong with the name typed into the rename field, or `undefined` */
  renameError: string | undefined;
  onAction: (entry: ProjectEntry, action: ProjectAction, via: Via) => void;
  /** The rename field changed; lets the owner clear a stale error */
  onRenameChange: (value: string) => void;
  onRenameCommit: (entry: ProjectEntry, value: string) => void;
  onRenameCancel: () => void;
  /**
   * The ways in once every project is gone (Spec 08's EMPTY-01); without
   * it an empty list draws nothing, as a preview's does
   */
  empty?: { onStartProject: () => void; onOpenTutorials: () => void };
}

/** The prototype's key for each item; `pin` stands for Pin or Unpin */
const KEYS: Record<string, ProjectAction> = {
  o: "open",
  p: "pin",
  r: "rename",
  d: "duplicate",
  e: "export",
  g: "share-gist",
  Backspace: "delete",
  Delete: "delete",
};

/** A lesson is recognised by its workspace name, so it cannot be renamed */
const LESSON_ACTIONS: ReadonlySet<ProjectAction> = new Set([
  "open",
  "pin",
  "unpin",
  "export",
  "share-gist",
  "delete",
]);

/**
 * Whether a row offers an action, given whether it is the open project's.
 * Share works on the open project's files (Spec 05), so only the open row
 * offers it.
 */
const isAllowedFor =
  (isCurrent: boolean) => (entry: ProjectEntry, action: ProjectAction) =>
    (!entry.isLesson || LESSON_ACTIONS.has(action)) &&
    (action !== "share-gist" || isCurrent);

/**
 * On the row's middle at both its heights, 28 px on a desk and 52 on a phone;
 * `!` beats `SidebarMenuAction`'s own `peer-data-[size]` top, which fits a
 * 32 px row
 */
const ROW_MIDDLE = "top-1/2! -translate-y-1/2";

const pinAction = (entry: ProjectEntry): ProjectAction =>
  entry.pinned ? "unpin" : "pin";

/**
 * The navigation's projects, lessons among them, as the prototype draws
 * them: a row per workspace with the folder glyph (a lesson's with the
 * tutorial glyph, Spec 11), the open one marked, pinned ones with a pin, and
 * a menu of its actions whose letters work while it is open. Three skeleton
 * rows stand in while the names load, so no empty list flashes first. Draws
 * only what it is given; `ProjectList` connects it.
 */
const BaseProjectList = (props: BaseProjectListProps) => (
  <Group label="Projects" entries={props.projects} list={props} />
);

export default BaseProjectList;

/** Keys for the loading rows, three as Spec 11's "List loading" state draws */
const SKELETON_ROWS = ["first", "second", "third"];

const Group = ({
  label,
  entries,
  list,
}: {
  label: string;
  entries: ProjectEntry[];
  list: BaseProjectListProps;
}) => {
  const labelId = useId();
  return (
    // No side padding of its own: the rows line up with the items above,
    // whose group already insets them from the column's edges
    <SidebarGroup role="group" aria-labelledby={labelId} className="px-0 pt-5">
      {/* The prototype's section heading: small, grey, sentence case */}
      <SidebarGroupLabel
        id={labelId}
        // On a phone, the label type, lined up with the 52 px rows' text
        className="mb-1 h-4 text-xs font-normal text-subtle max-md:mb-1.5 max-md:px-3 max-md:text-caption max-md:font-label"
      >
        {label}
      </SidebarGroupLabel>
      <SidebarMenu className="gap-px">
        {list.loading &&
          SKELETON_ROWS.map((row) => (
            <SidebarMenuItem key={row}>
              <SidebarMenuSkeleton showIcon />
            </SidebarMenuItem>
          ))}
        {!list.loading &&
          entries.map((entry) => (
            <SidebarMenuItem key={entry.name}>
              {list.renaming === entry.name ? (
                <RenameField entry={entry} list={list} />
              ) : (
                <Row entry={entry} list={list} />
              )}
            </SidebarMenuItem>
          ))}
      </SidebarMenu>
      {!list.loading && entries.length === 0 && list.empty && (
        <NoProjects {...list.empty} />
      )}
    </SidebarGroup>
  );
};

/**
 * Spec 08's EMPTY-01 in the column: a quiet note the width of the rows, as
 * sidebars set an empty section (v0's Recent Chats, AirOps' Recents), not a
 * StageEmpty, whose display title and pill are for a stage. Its two ways in
 * are compact rows under the line, the text in line with it, the first in
 * the text's colour and the second quieter.
 */
const NoProjects = ({
  onStartProject,
  onOpenTutorials,
}: {
  onStartProject: () => void;
  onOpenTutorials: () => void;
}) => (
  // Three steps of type: the title the strongest (14 px, the text's colour),
  // the line a step below it, the actions the quietest (12 px) and set off
  // by a wider gap. The ghost rows carry their own padding, so the frame's
  // foot is shorter and the note reads evenly inset.
  <Empty className="items-stretch gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 pt-3 pb-1.5 text-left">
    <EmptyHeader className="max-w-none items-start gap-1">
      <EmptyTitle
        role="heading"
        aria-level={3}
        className="text-sm text-sidebar-foreground"
      >
        No projects
      </EmptyTitle>
      <EmptyDescription className="text-xs/normal font-read">
        Start from a template, or follow a tutorial.
      </EmptyDescription>
    </EmptyHeader>
    {/* One row on a phone's menu page, which has the width for both; a
        column in the desk's narrower sidebar, where they do not fit */}
    <EmptyContent className="max-w-none items-start gap-0 max-md:flex-row max-md:gap-4">
      <Button
        size="sm"
        variant="ghost"
        className="-ml-2 text-xs pointer-coarse:h-11"
        onClick={onStartProject}
      >
        <Plus data-icon="inline-start" />
        Start a project
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="-ml-2 text-xs text-muted-foreground pointer-coarse:h-11"
        onClick={onOpenTutorials}
      >
        <GraduationCap data-icon="inline-start" />
        Open tutorials
      </Button>
    </EmptyContent>
  </Empty>
);

const Row = ({
  entry,
  list,
}: {
  entry: ProjectEntry;
  list: BaseProjectListProps;
}) => {
  const [open, setOpen] = useState(false);
  // Rename swaps the row for a field that takes focus; the menu handing
  // focus back to its trigger on close would blur the field at once
  const keepFocus = useRef(false);
  const markerId = useId();
  const progressId = useId();
  // The marker and the progress describe the row and leave its name alone:
  // the row is found by its name
  const describedBy =
    [entry.marker && markerId, entry.progress && progressId]
      .filter(Boolean)
      .join(" ") || undefined;
  const isCurrent = entry.name === list.current;
  const Glyph = entry.isLesson ? GraduationCap : Folder;

  const run = (action: ProjectAction, via: Via) => {
    if (!isAllowedFor(isCurrent)(entry, action)) return;
    keepFocus.current = action === "rename";
    setOpen(false);
    list.onAction(entry, action, via);
  };

  // Ahead of Radix's typeahead, which would only move focus to the item
  // whose label starts with the letter
  const onKeyDown = (event: KeyboardEvent) => {
    // A letter in either case: under Shift or Caps Lock, D is what the
    // item's hint shows; named keys (Backspace, Delete) are matched as named
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const action = KEYS[key];
    if (!action || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    run(action === "pin" ? pinAction(entry) : action, "key");
  };

  return (
    <>
      <SidebarMenuButton
        isActive={isCurrent}
        aria-current={isCurrent ? "page" : undefined}
        aria-describedby={describedBy}
        onClick={() => list.onAction(entry, "open", "click")}
      >
        <Glyph
          aria-hidden
          data-glyph={entry.isLesson ? "lesson" : "project"}
          className={isCurrent ? "text-primary" : undefined}
        />
        {/* The name and what follows it share one line and one baseline. The
            name truncates only against what is shown: under the pointer the
            marker steps aside (design sync 4.21) and the name takes its room */}
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 truncate">{entry.name}</span>
          {(entry.pinned || entry.marker || entry.progress) && (
            // Hidden from the row's name, which is the project's name alone;
            // `aria-describedby` reads the marker and the progress by id
            <span
              aria-hidden
              className="ml-auto flex shrink-0 items-baseline gap-2 text-xs font-normal text-muted-foreground group-hover/menu-item:hidden"
            >
              {entry.marker && <Marker id={markerId} marker={entry.marker} />}
              {entry.progress && (
                <Progress id={progressId} progress={entry.progress} />
              )}
              {entry.pinned && (
                <span title="Pinned" className="self-center">
                  <Pin aria-hidden className="size-3" />
                </span>
              )}
            </span>
          )}
        </span>
      </SidebarMenuButton>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          {/* The open project's stays in view, as the prototype draws it;
              the others show on hover */}
          <SidebarMenuAction
            showOnHover={!isCurrent}
            className={ROW_MIDDLE}
            aria-label={`Actions for ${entry.name}`}
          >
            <EllipsisVertical />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          className="w-48"
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(event) => {
            if (keepFocus.current) event.preventDefault();
            keepFocus.current = false;
          }}
        >
          <Item
            icon={CornerDownLeft}
            hint="O"
            onSelect={() => run("open", "click")}
          >
            Open
          </Item>
          <Item
            icon={entry.pinned ? PinOff : Pin}
            hint="P"
            onSelect={() => run(pinAction(entry), "click")}
          >
            {entry.pinned ? "Unpin" : "Pin"}
          </Item>
          <DropdownMenuSeparator />
          {!entry.isLesson && (
            <>
              <Item
                icon={Pencil}
                hint="R"
                label={`Rename ${entry.name}`}
                onSelect={() => run("rename", "click")}
              >
                Rename
              </Item>
              <Item
                icon={Copy}
                hint="D"
                onSelect={() => run("duplicate", "click")}
              >
                Duplicate
              </Item>
            </>
          )}
          <Item
            icon={Download}
            hint="E"
            onSelect={() => run("export", "click")}
          >
            Export as zip
          </Item>
          {isCurrent && (
            <Item
              icon={Share2}
              hint="G"
              label={`Share ${entry.name}`}
              onSelect={() => run("share-gist", "click")}
            >
              Share
            </Item>
          )}
          <DropdownMenuSeparator />
          <Item
            icon={Trash2}
            hint={"\u232B" /* the Backspace symbol */}
            label={`Delete ${entry.name}`}
            destructive
            onSelect={() => run("delete", "click")}
          >
            Delete
          </Item>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

/** Spec 02's words for each marker */
const MARKER_TEXT: Record<SyncMarker, string> = {
  "this-browser": "This browser",
  "not-synced": "Not synced",
};

/**
 * Where a project's work lives, when the account does not hold it. Spec 02
 * names the words, not the look: quiet caption text where the pin sits, so the
 * row's action keeps its place, and "Not synced" with a warning dot
 */
const Marker = ({ id, marker }: { id: string; marker: SyncMarker }) => (
  <span
    id={id}
    data-sync-marker={marker}
    className="flex items-baseline gap-1.5 whitespace-nowrap text-subtle"
  >
    {marker === "not-synced" && (
      <StatusDot variant="warning" className="self-center" />
    )}
    {MARKER_TEXT[marker]}
  </span>
);

/**
 * A lesson's place as "3 of 5", the way the tutorial list and the catalogue
 * card write it, or a check once it is finished. The digits and
 * the check are for the eye and hidden from screen readers; the words beside
 * them carry the id that describes the row, so the row keeps its name
 */
const Progress = ({
  id,
  progress,
}: {
  id: string;
  progress: LessonProgress;
}) => {
  if (progress.state === "completed") {
    return (
      <span
        data-lesson-progress="completed"
        title="Completed"
        className="self-center"
      >
        <Check aria-hidden className="size-3" />
        <span id={id} className="sr-only">
          Completed
        </span>
      </span>
    );
  }
  return (
    <span data-lesson-progress="started" className="tabular-nums">
      <span aria-hidden>{`${progress.page} of ${progress.pages}`}</span>
      <span id={id} className="sr-only">
        {`Page ${progress.page} of ${progress.pages}`}
      </span>
    </span>
  );
};

const Item = ({
  icon: Icon,
  hint,
  label,
  destructive,
  onSelect,
  children,
}: {
  icon: ComponentType<{ "aria-hidden"?: boolean }>;
  hint: string;
  /** The accessible name, where the visible one would be ambiguous */
  label?: string;
  destructive?: boolean;
  onSelect: () => void;
  children: string;
}) => (
  <DropdownMenuItem
    variant={destructive ? "destructive" : "default"}
    aria-label={label}
    onSelect={onSelect}
  >
    <Icon aria-hidden />
    <MenuItemText>{children}</MenuItemText>
    <DropdownMenuShortcut aria-hidden>{hint}</DropdownMenuShortcut>
  </DropdownMenuItem>
);

const RenameField = ({
  entry,
  list,
}: {
  entry: ProjectEntry;
  list: BaseProjectListProps;
}) => {
  const [value, setValue] = useState(entry.name);
  const errorId = useId();
  // Enter and Escape end the edit; the blur that follows must not end it again
  const ended = useRef(false);

  const finish = (commit: boolean) => {
    ended.current = true;
    if (commit && value !== entry.name) list.onRenameCommit(entry, value);
    else list.onRenameCancel();
  };

  return (
    <div className="flex flex-col gap-1 px-1 py-0.5">
      <Input
        aria-label={`Rename ${entry.name}`}
        aria-invalid={list.renameError ? true : undefined}
        aria-describedby={list.renameError ? errorId : undefined}
        spellCheck={false}
        autoFocus
        className="h-8"
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          ended.current = false;
          setValue(event.target.value);
          list.onRenameChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        onBlur={() => {
          if (ended.current) {
            ended.current = false;
            return;
          }
          finish(true);
        }}
      />
      {list.renameError && (
        <p id={errorId} role="alert" className="px-1 text-xs text-destructive">
          {list.renameError}
        </p>
      )}
    </div>
  );
};
