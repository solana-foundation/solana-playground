# Proposal

## Why

The assistant's off row (`#assistant-ai-off`) says why no model can answer in a
single body line, and with no hosted model it offers no way to ask again short of
a reload. The designers' Spec 08 (AI-01) and Spec 04 ("Model unavailable") give
each off state a title, a Try again, and a status that names the state in the
assistant's head. HOO-2577.

## What Changes

- Each reason of the off row gets a title over its body line:
  - no hosted model: "The assistant has no model";
  - the status route fails: "Model not answering";
  - a hosted model, nobody signed in: "Sign in to use the assistant" (no spec
    title; decided here and sent to the designers).
- With no hosted model the row also offers **Try again**, after **Add an API key**,
  asking `GET /api/ai/status` again.
- While the row stands, the assistant's head shows a status beside the model
  label, a status dot with a word: "Off" (no hosted model, signed out) or
  "Not responding" (the status route fails), the words the status row uses
  (it gains "Not responding" for AI in HOO-2582) (Spec 08 says "Assistant off" and Spec 04 "Unavailable"; one state
  keeps one word across the app).
- Body lines and button labels stay as they are. The key button keeps the design
  system's "Add an API key" over the specs' "Add OpenAI key", since Connect a
  model takes keys for four providers.
- Telemetry: no event added, renamed or removed. `assistant_default_probe_retried`
  already fires from the row's Try again, whichever reason shows it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assistant-ai-gate`: the off row's titles, Try again on the no-key reason, and
  the head's status while the row stands.

## Impact

- `client-v2/src/widgets/assistant/ui/BaseAiOffRow.tsx`,
  `BaseAssistantHead.tsx`, `Assistant.tsx`, and their tests;
  `e2e/assistant-ai-gate.e2e.spec.ts`.
- Out of scope: the panel-wide StageEmpty that Spec 08 draws for AI-01 (the row
  stays above the composer, as Spec 06 keeps the composer on screen); hiding
  Explain while AI-01 is active; the in-thread failures AI-02 to AI-13; the
  footer status panel's "AI · Off" (Spec 06, HOO-2582).
