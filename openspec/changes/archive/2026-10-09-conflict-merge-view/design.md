# Design

## Context

Every divergent conflict with named files is raised from one place:
`PgProjectSync._mergeWithServer` (`features/persistence/model/project-sync.ts`)
runs `planMerge` and, when `plan.conflicts` is non-empty and the user has not
answered for exactly those paths (`prefer` + `asked`), raises
`{kind: "divergent", paths}` and writes nothing. Reconcile reaches it through
`settleDivergence`, a refused push through the 409 path, and the banner's two
answers through `resolve`, which calls `mergeWithServer` again with `prefer`.
So the answer is always applied by a fresh merge that re-reads the server --
an answer is a rule for settling whatever conflicts the next read finds.

`merge3` (`model/merge.ts`) already groups overlapping-or-touching hunks of
the two sides; on a group where the sides differ it returns `null` and the
groups are lost. Conflicts live in memory only (`PgProjectSync._conflicts`);
reconcile re-raises them after a reload.

`client-v2` has the design system's install path since #50 (`yarn ds-add`)
but nothing installed in `shared/ui` yet. Monaco is pinned at 0.37.1; the
explorer keys its models by `monaco.Uri.parse(file.path)`.

## Goals / Non-Goals

**Goals:**

- The merge result and its conflicts as data the view can draw from, with
  no second diff run in the UI.
- An answer that cannot be applied to versions the user never saw.
- One write path: the resolved files go through the same merge, mark, base
  and upload code as "Keep this version" does today.
- The design-system element owns look and layout; the editors are the
  app's.

**Non-Goals:**

- The assistant performing the merge. The answer format (resolved content
  per file) is what it would produce; wiring it is a follow-up change.
- Carrying the user's per-hunk choices across a refresh.
- Whitespace modes, word-level ignore, or a settings menu in the view.

## Decisions

### `merge3` returns chunks

```ts
type Chunk =
  | { kind: "settled"; lines: string[]; changes?: SettledChange[] }
  | { kind: "conflict"; base: string[]; ours: string[]; theirs: string[] };

type Merge3 =
  | { kind: "clean"; text: string }
  | { kind: "conflict"; chunks: Chunk[] };
```

The chunks cover the whole file in order, so each pane is a join: left is
settled + `ours`, right is settled + `theirs`, and the result starts as
settled + `base`. Line positions, folds and ribbon offsets all follow from
chunk lengths, so `merge3` reports none. Split and join stay on `\n` alone,
so `\r` and a missing final newline survive exactly as today.

A settled chunk also says which of its lines one side changed on its own
(`changes`: a run of lines and `ours`, `theirs` or `both`), which `merge3`
knows as it applies that side's group. The view marks those lines as
changed in the result and that side's pane. It is the only way it can tell
them from untouched lines without diffing again, and no write path reads it.

_Alternative:_ return hunk positions against the base and let the view
rebuild the panes. Rejected: two places would have to agree on how a group
renders, and the merge already renders each side (`render` in `merge3`).

### `planMerge` carries a conflict per file

```ts
type FileConflict =
  | {
      kind: "lines";
      path: string;
      chunks: Chunk[];
      localHash: string;
      serverHash: string;
    }
  | {
      kind: "whole";
      path: string;
      local?: string;
      server?: string;
      localHash?: string;
      serverHash?: string;
    }
  | {
      kind: "settled";
      path: string;
      content?: string;
      localHash?: string;
      serverHash?: string;
    };
```

`"whole"` is every conflicted user file that `merge3` never ran on: no base
captured, a base whose hash does not match the mark, a side that deleted
the file (absent `local` or `server`), or copies that break lines in ways
the view cannot show line by line -- `mixesLineBreaks`: more than one kind
of line break across the copies, or a lone `\r`, which Monaco would show as
a line break of its own, so hunks would differ by bytes no pane shows. The view shows it as one hunk; the
result starts from this device's copy, or empty when this device deleted it.
`MergePlan.conflicts` becomes `FileConflict[]`; callers that wanted paths
read `.path`.

`"settled"` is never in a plan. It is a file a refused answer was about
(see "An answer is resolved content, pinned to hashes") that now merges on
its own, raised again beside the files still in conflict; `content` is what
it merges to, absent when the merge leaves no file. The view shows it in
every pane with nothing to decide, and Apply answers it with that content
against the new pins.

### The divergent conflict holds the files, in memory

`Conflict` gains `files?: FileConflict[]`; `paths` stays, derived from them,
so the banner and every existing check on `paths` are unchanged. Memory
only, as now: the chunks hold file contents, and a reload re-raises the
conflict with fresh ones.

### An answer is resolved content, pinned to hashes

```ts
type ResolvedFiles = Record<
  string,
  {
    content: string | null; // null: delete the file
    localHash?: string;
    serverHash?: string; // what the view was shown
  }
>;
type Answer = "local" | "server" | ResolvedFiles;
```

`mergeWithServer(projectId, name, prefer?: Answer, asked?)`. On each
attempt, after `planMerge`, every conflict path must be in `asked` (as
today) and, for a `ResolvedFiles` answer, have an entry whose hashes equal
this attempt's `localHashes[path]` and `serverHashes[path]`. Any miss raises
the divergent conflict again with this attempt's files and writes nothing --
including the answered files that would now merge on their own, raised as
`"settled"` (`refusedOf`): the user answered about copies that are gone, so
the view shows where those files stand rather than settling them behind
the user's back, and pushes for the project stay stopped until Apply. The
banner names only the files still in conflict as changed "in the same
place".
On a match, `settleConflicts` takes the entry's content. The name follows
`mergeName` as for `"local"`. Everything after -- `replaceWorkspaceFiles`,
`PgSyncMark.write`, `baseAfterMerge`, the push, the 409 retry loop -- is
the existing code.

`Resolution` gains `{kind: "resolved"; files: ResolvedFiles}` beside the
string answers, and `resolve` passes it through with the conflict's
`paths` as `asked`.

_Alternative:_ apply the resolved content directly as the new local copy
and push. Rejected: it skips the re-read, so another device's newer save
would be overwritten by an answer about an older version.

_Alternative:_ re-apply per-hunk choices to the new chunks by matching
content. Rejected for now (non-goal): a choice about lines that changed
again is not an answer about the new lines.

### Refresh while open

The connected view subscribes to `onDidChangeConflicts`. A raise for the
same project with different file hashes replaces the view's files and shows
"`<path>` changed on the other device". Pinned hashes make this safe
without locking: the stale answer can only fail.

### The design-system element draws; the client edits

`design-system/src/components/ui/merge.tsx`, registry item `merge`
(`registry:ui`; depends on `playground-tokens` and `segmented`). Compound
parts with `data-slot` names:

| Part                                                                   | Draws                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Merge`                                                                | root column, fits `ModalContent size="wide"`                                                                                      |
| `MergeToolbar`, `MergeNav`, `MergeTitle`, `MergeCount`, `MergeShowAll` | previous/next conflict and file, path and "file n of m", "n conflicts left", the fold toggle                                      |
| `MergePanes`                                                           | pane, ribbon, pane, ribbon, pane; one pane, picked by `MergePaneTabs`, while the merge box is narrower than 48rem (a container query) |
| `MergePane side`, `MergePaneHeader`, `MergePaneBody`                   | label, lock on read-only sides, an empty slot for the app's editor                                                                |
| `MergeRibbon`                                                          | SVG bands from pixel offsets `{fromTop, fromBottom, toTop, toBottom, state}[]`                                                    |
| `MergeHunkActions`, `MergeHunkAction`, `mergeHunkOrder`                | `×` `»` and `«` `×` icon buttons, mirrored about the result, with their accessible names                                          |
| `MergeHunkGutter`                                                      | a side's column for its controls beside the ribbon: last in the left pane, first in the right, mirrored; not drawn at phone width |
| `MergeHunkBar`, `MergeHunkBarSide`                                     | at phone width, a row under each open hunk in the result with both sides' controls, each named, mirrored                          |
| `MergeFold`                                                            | "⋯ n unchanged lines" button                                                                                                      |
| `MergeFooter`, `MergeFooterShortcuts`, `MergeFooterActions`            | the whole-file shortcuts left, Cancel / Apply right                                                                               |

`mergeHunkVariants` (exported `cva`) gives the state classes: `conflict` on
`error`, `changed` on `info`, `resolved` on `success`, and `dismissed` on the
muted tokens, since lines left out need no attention. The client hands the
same class names to Monaco decorations, so editor highlights and ribbons
change together.

_Alternatives:_ Monaco inside the element (the design system would depend on
Monaco and on client-v2's pin, themes and languages); a light editor of our
own (no highlighting, keybindings or vim in the result). Both rejected.

### Footer labels follow the banner, not IDEA

IDEA's "Accept Left" / "Accept Right" are "Keep this version" / "Take the
other version" here: one action, one name, in the banner and the view.

### The client's Monaco controller

`features/persistence/ui/merge-editor/`, plain TypeScript over Monaco, with
`BaseConflictResolver` (props only: files, `onApply`, `onKeepLocal`,
`onTakeServer`, `onCancel`) and the connected `ConflictResolver` beside it.

- Models in a `pg-merge:` scheme with no leading slash
  (`pg-merge:left/src/lib.rs`), disposed on close. The explorer,
  `editor-buffers` and `PgEditorModels` find models by `uri.path` alone and
  drop every model under a `/<workspace>/` prefix, so a slashed path would
  read as a file of a workspace named `left`, `result` or `right`. Pane and
  path are unique: one view is open at a time, one file's models at once.
  Language from the extension; the app's theme and editor settings apply.
- Alignment by view-zone spacers, so a hunk takes the same height in all
  three panes; scroll synced through `onDidScrollChange` / `setScrollTop`.
- Folding through `setHiddenAreas`, which exists on the 0.37 editor but not
  in its `.d.ts`. One wrapper with a local type; if the method is missing
  the view shows every line and hides "Show all lines".
- Hunk controls rendered by React into overlay widgets.
- Hunk state per side: `pending | taken | dismissed`, plus `edited` when a
  change in the result touches the hunk's range (tracked with a decoration
  that moves with edits). Taking inserts that side's lines at the hunk in
  the result, this device's always before the other's. In a `"whole"`
  conflict (no common base, or a side that deleted the file), taking either
  side dismisses the other: the answer is one file or the other.
- Undo and redo restore the hunk state kept for that version of the
  result (`getAlternativeVersionId`); each take or dismissal is its own
  undo step.
- Apply reads the result models into `ResolvedFiles` with the hashes the
  files arrived with. On a `"whole"` conflict where a side is absent, an
  empty result becomes `content: null` when it is what was chosen: the
  deleting side taken, this device's delete kept, or a result that held
  lines emptied by hand. Taking a side's empty file keeps it.

### Installing into `client-v2`

`yarn ds-add modal merge` lands them (and `segmented`) in `shared/ui`,
beside the components and the tokens in `src/app/styles/playground-*.css`
that `ui-migration` task 3.6 installed (PR #56). The stock `button` they
build on is a registry item too, so nothing comes from `ui.shadcn.com`.

## Risks / Trade-offs

- [`setHiddenAreas` is not public API and could change on a Monaco
  upgrade] → one wrapper, a fallback to "show everything", and a unit test
  that fails if the method disappears from the pinned version.
- [The view is drawn in the design system's tokens, not the app's theme
  objects] → the token bridge (HOO-1802, #58) switches those tokens with the
  theme through `.dark` on `<html>`. The view sets no mode class of its own:
  pinning `.dark` on it left its surfaces dark under the Light theme while
  Monaco drew light-theme text on them.
- [Three Monaco editors are heavy] → created on open, disposed on close;
  one file's models at a time.
- [A pinned answer can be refused repeatedly if the other device keeps
  saving] → each refusal shows the new state; the whole-file shortcuts
  remain an exit.
- [`Conflict.files` holds file contents in memory] → only for files in
  conflict, only while the conflict is outstanding.

## Migration Plan

No stored data changes shape: conflicts are memory-only and the mark and
base are written as before. Rollback is a revert; the banner's two answers
work throughout.

## Open Questions

- How many context lines to keep around a hunk when folding (IDEA uses a
  handful). Tuned in the catalogue; does not change behaviour beyond the
  "Unchanged regions are folded" requirement.
