# Design

## Context

`BaseAssistantComposer` drew the + menu with three entries, the last one
"Connect a model…" or "Connection and key…" from `connectLabel`, and K as its
shortcut through `usePickedMenu`. The head's More (`BaseAssistantHead`) has the
same entry with the same key, and with nothing connected the model slot in the
composer's toolbar is a "Connect a model" button too.

## Goals / Non-Goals

Goals: one meaning for +, "what goes with the message"; one Connect entry per
surface. Non-goals: changing More, the model button or the Connect dialog.

## Decisions

- **Sources and tools stays in +.** It decides which skills and tools the
  assistant can use, so it is context too, and the menu keeps more than one
  entry. The head's More keeps it as well, with the same S.
- **The composer drops `onConnect` and `connectLabel`.** Nothing in + needs
  them; `usePickedMenu` keeps only S there.
- **`via: "add"` goes from the type.** No caller is left, and a value no code
  can send only misleads a reader of the events.

## Risks / Trade-offs

Someone used to + for Connect finds it one step away, on the model button
beside it or in More. Usability round 1 (DES-215) can confirm.
