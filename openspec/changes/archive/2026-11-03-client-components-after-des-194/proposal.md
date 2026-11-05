# Proposal

## Why

Three pieces of the old client did not survive the move to the design
system: the toast's accent progress bar, the name field's message above it
and its success edge, and a lesson's progress in the project list. Nikita's
answer on DES-194 (30 Oct) narrowed HOO-2057 to building these three in
client-v2 from existing design-system parts.

## What Changes

- A timed toast shows a thin accent bar along its foot that drains over the
  toast's duration and pauses while the toasts are hovered. A persistent toast
  has no bar; under reduced motion the bar is not drawn.
- New project's name field shows its message before the field (on its left
  in the one row, above it on a phone), and a typed name that passes the
  format check gets a success edge. The taken-name check
  stays on Start.
- A started lesson's row in the project list shows its page as "3/5" at the
  row's end; a finished lesson shows a check. Both hide on hover and focus,
  like the pin and the sync marker. This reverses the "no step count" line of
  lesson-prototype-polish (R60) on Slava's word (2 Nov).
- Telemetry: none added, renamed or removed.

## Capabilities

### New Capabilities

None. The capabilities below live only in ui-migration's deltas so far.

### Modified Capabilities

- `client-v2-overlays`: timed toasts show how long they stay.
- `client-v2-layout`: the name field's message and success edge; lesson
  progress in the project list.

## Impact

- `widgets/overlays/ui/ToastHost.tsx` (and a small toast-progress part),
  `features/new-project/ui/BaseStartFromScratch.tsx`,
  `widgets/app-nav/ui/BaseProjectList.tsx`, `ProjectList.tsx` and
  `model/project-entries.ts`; their unit tests.
- ui-migration's `client-v2-layout` delta: the one "no step count" phrase in
  "The navigation lists the projects" is replaced; nothing else there changes.
- Out of scope: registry entries in the design system (Nikita, card 1.7), the
  phone LessonBar (dropped), SearchBar (HOO-2207), the wallet (HOO-2074), and
  the rename field in the project list, which keeps its error under the row.
