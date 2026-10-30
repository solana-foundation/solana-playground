# Design

## Context

The panel's turn lives in `useTurn` (`widgets/assistant/model/use-turn.ts`), shared by the thread and the composer; the store (`views/sidebar/assistant/store.ts`) owns the items, which sync to the account and merge by `updatedAt`. A patch reaches the file through the `write_file` tool (`model/tools.ts`), one file per card, after the card's Apply. Almaz's stand has a working Undo; it is the reference for behaviour, not code to port.

## Goals / Non-Goals

**Goals:** the behaviour in the three delta specs, inside the existing Base/connected pairs, with no change to `shared/ui`.

**Non-Goals:** deleting items from a synced thread; multi-file patch cards; the selection chip.

## Decisions

- **Undo is a module beside the store, in memory.** `PgPatchUndo` keeps the ids of patches this tab wrote (`tools.ts` records one after `applyPatch` succeeds) and decides `can(item)` by comparing the file's current content with the card's `after`, ignoring `declare_id!` (a build rewrites it). A stored card keeps only the region it shows (`trimPatch`), so a restored card cannot be undone, which matches Spec 04's "until reload". Alternative: an undo snapshot in the stored item; rejected, it would sync whole files to the account.
- **`undone` is a field on the approval, not a fifth status.** `ApprovalStatus` drives the codec (`pending` → `unanswered`) and the server; a flag next to it (`undone?: true`, stamped) leaves both alone and survives a sync because items are stored whole.
- **Undo writes through the bridge.** `realBridge.applyPatch` with the old content (with the file's current `declare_id!`), or a new `deleteFile` for a created file; Monaco's model follows as it does for Apply.
- **Can-undo is read at render.** The card asks `PgPatchUndo.can` on every thread render; an edit in the editor does not re-render the thread, so `undo` checks again and, when the file moved on, writes nothing and adds the "You edited … Use undo in the editor." notice.
- **Stopped stays a notice, named once.** `STOPPED_NOTICE` with `isStoppedNotice` live in the store. The thread offers Try again only on the last item, when no turn runs and it is that notice or a cut-off reply, and resends the last user message through `turn.send`. Appending, not replacing, keeps the synced thread append-only.
- **A reply carries its own state.** `startAssistantMessage` stamps `state: "streaming"`; the store records the ids the running turn opened, and `endTurn` clears `state` on them (stamped), unless `useTurn` marked one `cut-off` first. `isCutOff(item)` is `state === "cut-off"`, or `"streaming"` on a reply the running turn did not open: a reload or a closed tab leaves exactly that behind. Derived at render, not written back, so a second device that pulls a reply mid-stream shows it cut off only until the finished copy arrives and folds in. Alternative: a stored notice at load; rejected, it would be written on the wrong device in that race and never go.
- **A network cut is a `TypeError` naming the network, after text.** `fetch` and a broken stream reject with one ("Failed to fetch", "Load failed", "network error", "terminated"); a programming `TypeError` keeps its message. When the turn's last reply is still the thread's last item and has text, `useTurn` marks it `cut-off`, logs the error and sends `assistant_reply_failed { reason: "interrupted" }`; anything else stays an error item.
- **Escape stops.** `BaseAssistantComposer` calls `onStop` on Escape in the input while `busy`.
- **Phone targets.** Chips, the chip's remove button and Undo patch get a 44 px hit area below `md` (a transparent extension around the drawn size), so the drawn chip stays the DS's 22 px.
- **The open file is left out per turn.** `Provider.send` takes an optional `{ openFile: boolean }`, passed to `describeProject`, which then names the path without the content. `useTurn` holds the flag (`leaveOutOpenFile`) and `start` clears it once a turn begins, so a suggestion or a requested prompt honours it too.
- **The + menu mirrors More.** `BaseAssistantComposer` takes `onSources`, `onConnect`, `connectLabel` and `focusPicked`, and draws `ComposerAdd` as a `DropdownMenu` trigger with the same items and shortcuts as `BaseAssistantHead`; `Assistant` hands both the same handlers, the same `focusPicked`, and the label pair "Connect a model…" / "Connection and key…".
- **Thinking is a Base part with its own clock.** The thread's working marker becomes "Thinking" plus the seconds since the marker appeared; the seconds are `aria-hidden` and the `role="status"` name stays "Assistant is working", so it is announced once. The spinner stops under `prefers-reduced-motion`.
- **Telemetry:** Spec 04's names under the slice's prefix (`EVENT_PREFIXES`: a slice's events start with its own): `assistant_patch_undone { via: "card" }`, `assistant_reply_retried { after }`, `assistant_reply_failed { reason: "interrupted" }`, `assistant_file_chip_removed`, and `via: "add"` on `assistant_connect_opened`. A reload's cut-off sends no event: it is found at render, and an event there would fire on every mount.

## Risks / Trade-offs

- [The stopped reply stays above the retried one] → accepted; Spec 04 says replace, synced threads never delete. Flagged as a design gap.
- [`TypeError` is broad] → only counts after text streamed; other failures keep their message.
- [A reply pulled mid-stream on a second device reads as cut off until the finished copy arrives] → accepted; it heals on the next pull.
- [HOO-1719 (#208) and HOO-1752 touch `store.ts`, `use-turn.ts`, `Thread.tsx`, `BaseThreadItem.tsx`, `AssistantComposer.tsx`] → this PR rebases on whichever lands first and keeps its edits to those files small.
