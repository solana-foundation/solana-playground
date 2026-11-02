# Proposal

## Why

A key can bring any model id, and some are long (`deepseek/deepseek-chat-v3.1:free`): the composer's model button has no width limit, so a long name pushes Effort and Send, and on a phone it can push them out of the box. Spec 04 (Program Pal, Open Questions "Send with no model, and a long model name") answers HOO-2153: truncate at the end, show the whole name on demand, and name the model in the column's head.

## What Changes

- The composer's model button caps its width and ends a name that does not fit in "…"; a tooltip shows the whole name, only when it was cut.
- The assistant's head names the model instead of the project: "Assistant · {model} · hosted" for the hosted model, "{model} · your {provider} key" with a key, "Assistant" while no model is available or it is still being checked. Only the model part truncates, with the same tooltip.
- The model menu shows every name in full: a long one wraps, never cuts.
- With no model, Send stays disabled and the typed text stays; "Connect a model…" stays in More and on the model button. Already built; this change pins it with tests.
- Telemetry: the `assistant` widget's events are unchanged; showing a tooltip is not a user action worth an event.

## Capabilities

### New Capabilities

- `assistant-model-name`: how the assistant names the model it talks to, in the head, the composer and the model menu, and what the composer does when there is no model.

### Modified Capabilities

None.

## Impact

- `client-v2/src/widgets/assistant/`: `ui/BaseAssistantHead.tsx`, `ui/Assistant.tsx`, `ui/BaseModelMenu.tsx`, a new `ui/OverflowTooltip.tsx`, a new `model/head-label.ts`, and their tests.
- The head no longer shows the project's name; the thread and the empty state still get it.
- Out of scope: the prototype's composer add (+) menu, not built yet (its "Connect a model…" is offered from More meanwhile), the head's status, the rest of Spec 04's copy table (status, empty state, foot note), any server or `client-v2/api/` change, `shared/ui` (installed, unchanged).
