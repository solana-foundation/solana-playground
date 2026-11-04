# Design

## Context

`aiOff` (`widgets/assistant/model/ai-off.ts`) derives the off reason from the
connection, the status route's answer and the session; `AssistantComposer`
computes it and draws `BaseAiOffRow`. The head (`BaseAssistantHead`) is drawn by
`Assistant`, which already reads the connection and `useDefaultBackend`, but not
the session. Design sources: the DS prototype draws no off state; Spec 08 AI-01
and Spec 04 give the words.

## Goals / Non-Goals

**Goals:** a title per reason, Try again on no-key, the head's status, from the
one `aiOff` derivation so row and head never disagree.

**Non-Goals:** a StageEmpty replacing the panel, Explain hiding, any new event.

## Decisions

- **The row stays a Callout above the composer, now with `CalloutTitle`.**
  Spec 08 draws AI-01 as a StageEmpty in the panel; Spec 06 keeps the composer on
  screen with the reason in its top row, which #247 built. A titled Callout gives
  Spec 08's words without taking the thread away. Sent to the designers as a gap.
- **"Add an API key", not "Add OpenAI key".** The DS model menu says "Add an API
  key", and Connect a model takes OpenAI, Anthropic, OpenRouter and Gemini keys.
- **The head's status is a StatusDot with a word**, the DS's "one sign for state,
  always beside a word". The words follow the status row (`aiIndicator` on scope/interface, not yet on
  this branch): "Off",
  `idle`, since no model is a setup step, not a failure; and "Not responding",
  `error`, for a status route that failed, the word the status row uses for a
  cluster that does not answer; the status row's AI item gets it in HOO-2582. Spec 08's "Assistant off" and Spec 04's
  "Unavailable" would give one state two words (Design alignment, 4 Nov).
- **One derivation for row and head.** `useSignedIn` moves from
  `AssistantComposer` to `widgets/assistant/model/use-signed-in.ts`; `Assistant`
  runs the same pure `aiOff` over the same inputs for the head and passes nothing
  new to the composer, which keeps reporting `assistant_ai_off_shown` once per
  reason. The head is the lasting status, so it also shows in Sources and tools,
  where the row is not mounted. Alternative: lift the reason to `Assistant` and pass it down; rejected,
  because the composer's telemetry would then depend on a prop the head's parent
  owns, and both would still read the same stores.
- **Signed-out title** "Sign in to use the assistant": no spec gives one; five
  words, the action the row leads with.

## Risks / Trade-offs

- [The designers may want StageEmpty or "Add OpenAI key"] → both are batched as
  gaps for the design sync; each is a copy or layout swap inside `BaseAiOffRow`.
- [The status row has no "Not responding" for AI yet; it reads an unreachable
  status route as "AI · Off"] → raised with Design alignment for the status
  row's owner; the head's word swaps in one place if they pick another.
