# Proposal

## Why

The composer's + is named "Add context", but it also held "Connect a model…"
(K). With nothing connected that put three ways to one dialog side by side:
the + entry, the model button reading "Connect a model" right next to it, and
the head's More. Spec 04 already moves "Connect a model…" from the + menu to
More. DES-208 settles what the + holds: what the assistant reads, and nothing
about which model answers.

## What Changes

- The + menu ("Add context") holds "Add a file" (submenu) and "Sources and
  tools" (S). "Connect a model…" and "Connection and key…" (K) leave it; they
  stay on the model button and in the head's More, unchanged.
- Telemetry: `assistant_connect_opened` loses the `via` value `"add"`, which
  nothing sends any more. No event is added or renamed.
- The e2e test "Connect a model from the + menu" becomes "The + menu holds
  context only".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assistant-composer-context`: the + menu requirement and its scenarios.

## Impact

- `client-v2/src/widgets/assistant/ui/BaseAssistantComposer.tsx` and
  `AssistantComposer.tsx`, their unit tests, `model/telemetry.ts`, and
  `e2e/client-v2-assistant.e2e.spec.ts`. Built in #366 with DES-208.
- Out of scope: More and the model button, which keep their Connect entries
  as they are; an "Add selection" entry in + (the editor menu's Explain
  selection and Fix selection cover a selection); the selection chip.
