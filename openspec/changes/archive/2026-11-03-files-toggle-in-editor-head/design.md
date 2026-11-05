# Design

## Context

`BaseLayoutShell`'s work panel stacks, top to bottom: the stage bar (44 px,
with the files toggle "Collapse/Expand project panel"), the stage tabs, and
a horizontal group of the files column (`PANEL_SIZES.files`, 240 px default,
resizable, unmounted when closed) beside `center` (the stage over the
console). The files column (`views/flow/left/LeftPanel.tsx`) draws its own
40 px head ("Files" and "Hide files"), or in a lesson a Steps / Files
switch with the same Hide button. The editor's tab row (`components/Tabs`,
`#tabs`) is drawn inside the stage, by upstream's `EditorWithTabs`, which
`Primary` hosts on the Write stage; `Write` stays mounted on every stage and
is hidden with CSS. The shell already renders the stage and the console
through portals (`Outlet` / `OutletContent`) so they keep their state when
the layout around them changes.

The frame's current requirements are in the open `ui-migration` change,
`specs/client-v2-layout/spec.md`. This change supersedes, there:

- "The frame is flush, with a bar over each column": the stage bar's
  "Collapse project panel" / "Expand project panel";
- "Panels fold without losing their state", scenarios "Folding the project
  panel" and "The files column keeps its tree": the stage bar's toggle
  becomes the head's "Files";
- "The layout survives a reload" and `DEFAULT_LAYOUT`'s first visit: files
  closed instead of open.

`ui-migration` is an umbrella several tickets share, so this change does
not edit its spec; the superseded sentences are reported to Lead to fold in
when that change is next updated.

## Goals / Non-Goals

**Goals:**

- One head across the tree and the stage, so opening the tree moves nothing
  in it.
- The tab row keeps everything it does today (keys, drag, menu, wallet
  button, `#tabs` for `Wallet.tsx`'s lookup).

**Non-Goals:**

- A per-project open/closed memory.
- Any change below 768 px.

## Decisions

1. **A `workHead` slot in the shell, drawn between the stage tabs and the
   files/center group.** The shell owns the files and console state, so it
   hands the slot `{ files, console }`, each `{ open, toggle }`, and the
   toggles go through `setOpen(..., { via: "button" })` like every other
   button: the panel telemetry stays as it is. Alternative: put the toggles
   at the end of the tab row inside the stage. Rejected: the tree would
   then open beside the whole stage, tab row included, and push the tabs
   right, which is what DES-205 says must not happen.

2. **The tab row reaches the head through a portal host the head
   registers.** The head renders an empty host element on its left;
   `components/Tabs` renders into it with `createPortal` when the host
   exists, and in place when it does not (the legacy tutorial view, tests).
   The React tree, and so every context the tabs read, stays where
   `EditorWithTabs` mounts it. Alternative: lift `<Tabs />` out of
   `EditorWithTabs` into the shell. Rejected: `Primary` swaps
   `EditorWithTabs` for Home, tutorial and share pages, and the tabs would
   then show over pages that have none. The host is a tiny store in
   `widgets/layout-shell` (`model/editor-head-host.ts`): a setter the head
   calls from a ref callback and a hook `Tabs` reads.

3. **The tab row shows only on the Write stage.** `Write` stays mounted
   while hidden, so a portaled row would linger over Build. `Flow` passes
   the head `showTabs={stage === "write"}`, and the host takes `hidden`
   otherwise.

4. **The files column loses its head.** Outside a lesson the tree starts at
   the column's top; in a lesson the Steps / Files switch stays and loses
   its Hide button. `LeftPanel`'s `onHide` prop goes.

5. **First visit closed, saved layouts untouched.** `DEFAULT_LAYOUT.open.files`
   becomes `false`. No layout version bump: a saved `files: true` is a
   choice the product cannot tell from the old default, and DES-205's own
   note asks for open/closed to be remembered.

6. **Base + connected pair.** `BaseEditorHead` (in `widgets/layout-shell/ui`)
   draws the bar from props: `files`, `terminal` (`{ open, onToggle }`),
   `showTabs`, `hostRef`. The shell renders it itself, since it holds the
   state, so `Flow` needs to pass only `showTabs`. The icons are lucide's
   `Folder` and `Terminal` (`>_`), at 18 px in the design system's `Button`
   (`variant="ghost"`, 32 px square, 8 px radius).

## Risks / Trade-offs

- [`files-and-tabs-spec-11` group 2 edits `LeftPanel` and the explorer at
  the same time] → this change touches only `LeftPanel`'s head; whichever
  lands second rebases on a small hunk.
- [e2e specs click "Expand project panel" / "Hide files"] → updated in the
  same PR to the head's "Files"; `left-panel-toggle.e2e.spec.ts` and
  `client-v2-layout.e2e.spec.ts` are the ones named by grep.
- [A portal host that appears after `Tabs` mounts] → the host store notifies
  its readers, so the row moves into the head on the next render rather
  than staying in place.
