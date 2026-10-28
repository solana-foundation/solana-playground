import {
  Copy,
  CornerDownLeft,
  Download,
  EllipsisVertical,
  Folder,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import type { ComponentType, KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { MenuItemText } from "@/shared/ui/menu-extras";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import type { ProjectAction } from "../model/project-action";
import type { ProjectEntry } from "../model/project-entries";

type Via = "click" | "key";

export interface BaseProjectListProps {
  /** Projects and started lessons, in one list as the prototype draws it */
  projects: ProjectEntry[];
  /** The open workspace's name, or `null` when none is open */
  current: string | null;
  /** The entry whose row is the rename field, or `null` */
  renaming: string | null;
  /** What is wrong with the name typed into the rename field, or `null` */
  renameError: string | null;
  onAction: (entry: ProjectEntry, action: ProjectAction, via: Via) => void;
  /** The rename field changed; lets the owner clear a stale error */
  onRenameChange: (value: string) => void;
  onRenameCommit: (entry: ProjectEntry, value: string) => void;
  onRenameCancel: () => void;
}

/** The prototype's key for each item; `pin` stands for Pin or Unpin */
const KEYS: Record<string, ProjectAction> = {
  o: "open",
  p: "pin",
  r: "rename",
  d: "duplicate",
  e: "export",
  Backspace: "delete",
  Delete: "delete",
};

/** A lesson is recognised by its workspace name, so it cannot be renamed */
const LESSON_ACTIONS: ReadonlySet<ProjectAction> = new Set([
  "open",
  "pin",
  "unpin",
  "export",
  "delete",
]);

const allowed = (entry: ProjectEntry, action: ProjectAction) =>
  !entry.isLesson || LESSON_ACTIONS.has(action);

const pinAction = (entry: ProjectEntry): ProjectAction =>
  entry.pinned ? "unpin" : "pin";

/**
 * The navigation's projects, lessons among them, as the prototype draws
 * them: a row per workspace with the folder glyph, the open one marked,
 * pinned ones with a pin, and a menu of its actions whose letters work while
 * it is open. A lesson differs only in its menu. Draws only what it is
 * given; `ProjectList` connects it.
 */
const BaseProjectList = (props: BaseProjectListProps) => (
  <Group label="Projects" entries={props.projects} list={props} />
);

export default BaseProjectList;

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
        {entries.map((entry) => (
          <SidebarMenuItem key={entry.name}>
            {list.renaming === entry.name ? (
              <RenameField entry={entry} list={list} />
            ) : (
              <Row entry={entry} list={list} />
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
};

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
  const isCurrent = entry.name === list.current;

  const run = (action: ProjectAction, via: Via) => {
    if (!allowed(entry, action)) return;
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
        onClick={() => list.onAction(entry, "open", "click")}
      >
        <Folder
          aria-hidden
          className={isCurrent ? "text-primary" : undefined}
        />
        <span>{entry.name}</span>
      </SidebarMenuButton>
      {entry.pinned && (
        <span className="pointer-events-none absolute top-1.5 right-7 flex items-center gap-1 text-xs text-muted-foreground group-focus-within/menu-item:hidden group-hover/menu-item:hidden">
          <span title="Pinned">
            <Pin aria-hidden className="size-3" />
          </span>
        </span>
      )}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          {/* The open project's stays in view, as the prototype draws it;
              the others show on hover */}
          <SidebarMenuAction
            showOnHover={!isCurrent}
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
