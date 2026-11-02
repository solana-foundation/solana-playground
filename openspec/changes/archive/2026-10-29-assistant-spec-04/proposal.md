# Proposal

## Why

The Design alignment audit of 28 Oct (items C3, C4, C5) found the assistant short of Spec 04 and the prototype: an applied patch cannot be taken back from its card, the panel shows a bare spinner while it waits, "Stopped." offers no way to ask again, a dropped connection mid-reply looks like any other error, the context chips cannot be left out and read to a screen reader as a word or two, and the composer has no + menu. HOO-2387 asks for all of it, refreshed on 29 Oct against the DS prototype, Almaz's stand and Spec 04.

## What Changes

- An applied patch card offers **Undo patch** while the file still holds what the patch wrote, in the tab that applied it. Undo puts the file back as it was (a file the patch created is deleted) and the card reads **Undone**. On desktop and phone.
- While the assistant works with no text yet, the thread shows **Thinking** and, from the first second, the seconds elapsed ("Thinking 3s"). Announced once; static under reduced motion.
- "Stopped." gets a **Try again** button, and Escape in the composer stops a reply as Stop does. A reply cut off by a dropped connection, or by a reload while it streamed, keeps its text with **"This reply was cut off."** and **Try again**. Try again sends the last message again.
- The open-file chip has a remove control: the next message goes without that file's content, and the chip returns after it. Every chip has a screen-reader name that says what it sends. On a phone the chips, Undo patch and the chip's remove control are 44 px targets.
- The composer gets the design system's + (`ComposerAdd`), which opens a menu with **Sources and tools** and **Connect a model…** (with nothing connected) or **Connection and key…** (once connected). The head's More uses the same pair.
- After a prompt is placed in the composer by `PgAssistant.requestPrompt`, focus is in the composer, also when the panel mounts or leaves Sources to take it.
- Telemetry (`assistant` widget, Spec 04's names under the slice's `assistant_` prefix): adds `assistant_patch_undone { via: "card" }`, `assistant_reply_retried { after: "stopped" | "interrupted" }`, `assistant_reply_failed { reason: "interrupted" }` (a dropped connection) and `assistant_file_chip_removed`; `assistant_connect_opened` gains `via: "add"`.

## Capabilities

### New Capabilities

- `assistant-patch-undo`: taking back an applied patch from its card.
- `assistant-turn-states`: what the thread shows while a reply is pending, and after a reply was stopped or cut off.
- `assistant-composer-context`: the composer's context chips, its + menu, and where focus goes when a prompt is placed in it.

### Modified Capabilities

None.

## Impact

- `client-v2/src/widgets/assistant/`: `ui/BaseApprovalCard`, `ui/BaseThreadItem`, `ui/BaseThread`, `ui/Thread`, `ui/BaseAssistantComposer`, `ui/AssistantComposer`, `ui/Assistant`, `ui/BaseAssistantHead`, `model/use-turn`, `model/telemetry`, and their tests.
- `client-v2/src/views/sidebar/assistant/`: `store.ts` (an approval's `undone`, a reply's `state`, the stopped notice), a new `patch-undo.ts`, `model/tools.ts` (records a written patch), `model/prompt.ts` and `model/provider.ts` (a turn without the open file), `bridge/playground-bridge.ts` (`deleteFile`).
- A stored approval may carry `undone: true`; older readers ignore it.
- A stored reply may carry `state: "streaming" | "cut-off"`; older readers ignore it.
- Out of scope: replacing the stopped reply on Try again (synced threads never delete items), "Reject" → "Discard", Review in file, multi-file patch cards, the selection chip from the editor menu, the apply toast from the editor bar, `assistant_request_started` and the rest of Spec 04's pane events, the foot note's copy (the prototype's stays until the designers answer), any server or `api/` change, `shared/ui` (installed, unchanged).
