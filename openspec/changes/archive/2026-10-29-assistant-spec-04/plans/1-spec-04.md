# Assistant Spec 04 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Undo patch, Thinking with seconds, Stopped / cut off with Try again, Escape stops, removable open-file chip, chip names, the composer + menu, focus after a placed prompt (HOO-2387).

**Architecture:** Store-level state (`undone` on an approval, `state` on a reply) in `views/sidebar/assistant/store.ts`, an in-memory `PgPatchUndo` beside it, and the rest in the `widgets/assistant` Base/connected pairs. See `../design.md`.

**Tech Stack:** React 17, Tailwind 4, shadcn/Radix from `shared/ui`, vitest + Testing Library, Playwright.

**Spec:** `../specs/*/spec.md`, `../design.md`

## Global Constraints

- Copy: "Undo patch", "Undone", "Thinking", "{n}s", "Stopped.", "This reply was cut off.", "Try again", "You edited {path} after applying. Use undo in the editor.", "Add context", "Sources and tools", "Connect a model…", "Connection and key…", "Leave {file} out of the next message", "Sent with this message: {what}".
- Phone (< md): Undo patch, chips and the chip's remove button are ≥ 44 px targets.
- Events: `assistant_patch_undone { via: "card" }`, `assistant_reply_retried { after: "stopped" | "interrupted" }`, `assistant_reply_failed { reason: "interrupted" }`, `assistant_file_chip_removed`, `assistant_connect_opened.via` gains `"add"`.
- `shared/ui` is not edited. No nested ternaries. No empty catch. Strings two places compare are declared once.

## Review Focus

- A patch to a file that `declare_id!` was rewritten in by a build after Apply: Undo still offered, keeps the new id.
- Undo pressed twice fast: the second press writes nothing.
- Try again while the provider is still unwinding a stopped turn: refused like any send (the button is shown only when no turn runs).
- A reply pulled from another device mid-stream reads as cut off, then heals when the finished copy folds in.
- Escape in the composer with no turn running does nothing (and does not clear the text).

---

### Task 1: Undo patch (tasks 1.1, 1.2)

**Files:** Create `client-v2/src/views/sidebar/assistant/patch-undo.ts` and `patch-undo.test.ts` (a file of its own: it mocks the bridge); Modify `store.ts` (approval `undone?: true`, `markUndone(id, outcome)`), `bridge/playground-bridge.ts` (`deleteFile(path): Promise<void>`), `model/tools.ts` (`PgPatchUndo.wrote(id)` after `applyPatch`), `widgets/assistant/ui/BaseApprovalCard.tsx` (`onUndo?`), `ui/BaseThreadItem.tsx`, `ui/Thread.tsx`, `model/telemetry.ts`; Tests `BaseApprovalCard.test.tsx`, `Thread.test.tsx`.

**Interfaces:** Produces `PgPatchUndo.wrote(id: string): void`, `.can(item: ApprovalItem, bridge?): boolean`, `.undo(item, bridge?): Promise<"undone" | "moved-on" | "not-undoable">`; `BaseApprovalCard` prop `onUndo?: () => void`; `BaseThreadItem` prop `onUndo?: () => void`, supplied per item by `BaseThread`'s `undoFor(id)`.

- [ ] Failing tests: `can` true after `wrote` when file holds `after`; false when edited, when not recorded (restored), when `undone`; `undo` restores `before`, deletes when `before === null`, keeps the file's current `declare_id!`, returns `"moved-on"` and adds the notice "You edited {path} after applying. Use undo in the editor." when edited; `markUndone` stamps. Card: "Undo patch" shown only with `onUndo`, status "Undone" when `item.undone`, `h-11 min-w-11 md:h-8` on Undo.
- [ ] Implement; run `yarn test-unit src/views/sidebar/assistant/patch-undo.test.ts src/widgets/assistant`; PASS.
- [ ] Commit `feat(client-v2): undo an applied patch from its card (HOO-2387)`.

### Task 2: Turn states (tasks 2.1, 2.2)

**Files:** Modify `store.ts` (`STOPPED_NOTICE`, `isStoppedNotice`, reply `state`, `markCutOff(id)`, `isCutOff(item)`, live reply ids on `_turn`), `widgets/assistant/model/use-turn.ts`, `ui/BaseThread.tsx` (`Thinking`), `ui/BaseThreadItem.tsx` (notice/reply `onRetry`), `ui/Thread.tsx`, `ui/BaseAssistantComposer.tsx` (Escape), `model/telemetry.ts`; Tests `store.test.ts`, `use-turn.test.tsx`, `BaseThread.test.tsx`, `BaseThreadItem.test.tsx`, `Thread.test.tsx`, `BaseAssistantComposer.test.tsx`.

**Interfaces:** Produces `ChatItem` assistant `state?: "streaming" | "cut-off"`; `PgAssistant.isCutOff(item): boolean`; `useTurn().stop` unchanged; `BaseThreadItem` prop `onRetry?: () => void` (shown on that item only).

- [ ] Failing tests: Thinking reads "Thinking" then "3s" after 3 s (fake timers), seconds `aria-hidden`; a reply started in a turn has `state: "streaming"` until `endTurn` clears it; `isCutOff` true for `"cut-off"` and for `"streaming"` not opened by the running turn; `useTurn` turns a `TypeError` after text into `markCutOff` + `assistant_reply_failed`, a `TypeError` before text into an error item; Try again on last "Stopped." resends last user text and tracks `after: "stopped"`; on last cut-off reply tracks `after: "interrupted"`; not offered when not last or while busy; Escape while busy calls `onStop`, idle does nothing.
- [ ] Implement; run the tests; PASS.
- [ ] Commit `feat(client-v2): thinking seconds, try again after a stopped or cut-off reply (HOO-2387)`.

### Task 3: Composer (tasks 3.1–3.3)

**Files:** Modify `ui/BaseAssistantComposer.tsx`, `ui/AssistantComposer.tsx`, `ui/Assistant.tsx`, `ui/BaseAssistantHead.tsx` (connect label), `model/use-turn.ts` (`openFileLeftOut`, `leaveOutOpenFile()`; `start` passes `{ openFile }` to `Provider.send`), `views/sidebar/assistant/model/types.ts` (`Provider.send(input, signal?, context?: TurnContext)`), `model/provider.ts`, `model/prompt.ts` (`describeProject(bridge, { openFile })`), `model/telemetry.ts`; Tests for each.

**Interfaces:** `ComposerContextChip` gains `spoken: string` and `remove?: { label: string; run(): void }`; `BaseAssistantComposer` gains `onSources(): void`, `onConnect(): void`, `connectLabel: string`, `focusPicked(): boolean`; `BaseAssistantHead` gains the required `connectLabel`; `TurnContext = { openFile: boolean }`.

- [ ] Failing tests: chip accessible name equals `spoken`; remove button named "Leave lib.rs out of the next message" hides the chip, the next `send` passes `{ openFile: false }`, chip returns after; `describeProject(bridge, { openFile: false })` names the path, omits content; "Add context" menu lists "Sources and tools" and the connect label, S/K pick; More reads "Connection and key…" when connected; `requestPrompt(text, { send: false })` focuses the input, also from Sources.
- [ ] Implement; run the tests; PASS.
- [ ] Commit `feat(client-v2): composer + menu, removable file chip, chip names (HOO-2387)`.

### Task 4: Integration (task 4.1)

**Files:** Modify `client-v2/e2e/client-v2-assistant.e2e.spec.ts`: `assistant-patch-undo: Undoing an edit`, `assistant-turn-states: Try again after Stop`, `assistant-composer-context: Connect a model from the + menu`.

- [ ] Write the three specs; run `yarn test-e2e e2e/client-v2-assistant.e2e.spec.ts`; PASS.
- [ ] After screenshots (throwaway shots spec), `yarn run check`; green.
- [ ] Commit `test(client-v2): e2e for undo, try again and the + menu (HOO-2387)`.
