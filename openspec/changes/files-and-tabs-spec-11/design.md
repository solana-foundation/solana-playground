# Design

## Context

The parts this change touches sit in the legacy roots: `components/Editor`,
`components/Tabs`, `views/sidebar/explorer` and `utils/explorer/explorer.ts`,
which drives the tree's DOM directly and is never moved. The project list
(`widgets/app-nav`) and the dialog frame (`widgets/overlays`, `ModalFrame`) are
already on the design system. Autosave was rewritten on `scope/users-work`
(`components/Editor/Monaco/autosave.ts`, #179 and #196); `scope/interface` still
has the inline timer.

## Goals / Non-Goals

**Goals:**
- Every behaviour in `specs/client-v2-files/spec.md`, with the copy and the
  accessible names it gives.
- No change to how existing projects load or sync: an item stored under any
  name, dotted or not, keeps loading as the type it was stored as.

**Non-Goals:**
- Moving the explorer's React components into the layers. The tree's rows keep
  their element structure, ids and classes, because `explorer.ts` drives them.
- Arrow-key navigation inside the tree; the roles land now so it can follow.

## Decisions

**"Show files" reaches the shell through `PgView`.** The editor renders inside
the shell's work area and cannot import its state. `PgView` gains a request
event (`PgView.showFiles()`, `PgView.onDidRequestFiles`), the same pattern as
its other UI events. `LayoutShell` subscribes and opens the column on a desktop
(`setOpen("files", { open: true, via: "button" })`) or the Files page on a
phone. The press therefore sends the existing `layout_panel_toggled` event with
`via: "button"`; no event is added. Alternative: export a setter from
`widgets/layout-shell`; rejected because the editor would import the widget
that renders it.

**The empty editor is a Base pair in `widgets/layout-shell`.**
`BaseNoFileOpen` draws the design system's `Empty` (icon, title, outline
button) from props; `NoFileOpen` connects the button to `PgView.showFiles()`.
`Editor.tsx` renders `NoFileOpen` where it rendered `Home`. `Editor.tsx` was
`Editor/Home`'s only importer, so `Editor/Home` is deleted with its
`#home` background rule.

**An item's type comes from the explorer's state, not its name.**
`getItemTypeFromPath` answers from `PgExplorer.files` first: an entry with
`content` is a file; a path ending in `/`, an entry with no `content`, or any
entry under `path/` is a folder. Only a path the state does not hold falls back
to the dot rule, so sync, import and templates, which write dotted names, are
unchanged. `createItem` takes the type explicitly (`{ type: "file" | "folder" }`)
and the create field passes the command's choice. The IndexedDB loader asks
storage's metadata before it makes a path canonical, so an empty folder named
`v1.2` loads as a folder. `getFolderContent` classifies children the same way.
A rename keeps the old item's type rather than reading it from the new name.
Alternative: store a type flag on every entry; rejected because the sync
snapshot and the import paths build entries without one.

**Two name checks, not one.** `isItemNameValid` stays as it is: it filters
names when a project loads, and tightening it would hide stored files whose
names have spaces. A new `PgExplorer.checkItemName(name, siblings)` returns the
Spec 11 reason, or null, for a name the person types; the create and rename
fields use it and show the reason under the field.

**Refusals surface through the existing toast.** The drag-and-drop move and
Move to… share one `moveItem` path: `ALREADY_EXISTS` opens `ReplaceItem`;
every other error logs with `report: true` and toasts "Could not move {name}.
{reason}", the reason mapped from `PgExplorer.errors` to plain words.

**Move to… is a `ModalFrame` around the design system's `Command`.** The list
holds every folder of the project, `src` first, the item's own folder marked
and disabled, and the item itself and its descendants left out. Command's
filter field gives the keyboard path; a row press gives the pointer and touch
path.

**Tree roles are attributes on the existing elements.** The root `#root-dir`
gets `role="tree"`; `Folder` and `File` rows get `role="treeitem"` and
`aria-level` from their depth; a folder row's `aria-expanded` follows the
`OPEN` class, which `explorer.ts` toggles, through the same helper that
toggles the class. Children wrappers get `role="group"`. The dnd-kit
`role="button"` spread is overridden on rows.

**Delete dialogs keep `ModalFrame` and change their body.** The frame is
already the design system's; the dialogs are copy. `ModalFrame` gains
`openFocus: "cancel"` so Cancel has focus on open, and Enter submits only from
a field, so a phone (no Cancel) cannot delete on Enter. `DeleteWorkspace` reads
the session through `PgSession`; `DeleteItem` counts the files whose full path
sits under the folder in `PgExplorer.files`. A dialog title wraps anywhere
(`overflow-wrap: anywhere` in `BaseModalFrame`), for every dialog: a name
without spaces would otherwise widen the dialog past a 320 px phone.

**Autosave failure state is per file, owned by the editor.** A small store
(`components/Editor/Monaco/save-failures.ts` on `scope/users-work`) holds the
paths whose last write was refused. The autosave `save` catch adds the path,
a successful write removes it. The tab reads it for the marker; the editor
reads it for the FILE-01 callout (design system `Callout`, `warning`, with
Export project). `pagehide` calls `autosave.flush()`.

## Risks / Trade-offs

- [The type lookup scans `files` for a child prefix on a miss] → it runs only
  for a path with no entry of its own, which is a folder with children; the
  map holds one project's files, so the scan stays small.
- [A file named without a dot that was stored before this change] → the loader
  now reads storage's metadata, so it loads as a file; before, it showed as a
  folder.
- [Two scope branches touch `Monaco.tsx`] → only the autosave task touches it,
  and it lands on `scope/users-work`, where the autosave code lives.

## Migration Plan

No stored data changes. Rollback is a revert of each task's PR.
