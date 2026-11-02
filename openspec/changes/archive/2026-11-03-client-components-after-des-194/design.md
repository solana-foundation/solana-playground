# Design

## Context

Toasts render through Sonner (`widgets/overlays/ui/ToastHost.tsx`); our
content sits inside Sonner's default toast, which keeps its own timer and
pauses it while the toasts are expanded (pointer over them) or the page is
hidden. The name field is the design system's `Input` with `FieldError`
under it (`features/new-project/ui/BaseStartFromScratch.tsx`). Tutorial
progress is already read for the catalogue by `useTutorialProgress`
(`entities/tutorial`), which yields `new | started(page, pages) | completed`.

## Goals / Non-Goals

**Goals:** the three pieces as the old client and the prototype draw them,
built from parts client-v2 already has.

**Non-Goals:** a new design-system component or registry entry; changing
Sonner's timer; the rename field's error placement in the list.

## Decisions

- **The bar is a CSS animation, not a timer.** A `scaleX(1 → 0)` keyframe
  over the toast's duration, `linear`, `transform-origin: left`. It pauses
  through `animation-play-state` on the two lasting states where Sonner
  pauses its timer: the toasts expanded under the pointer
  (`[data-expanded="true"]`) and a hidden page (`visibilitychange`), where a
  CSS animation would otherwise run on. A press held on a toast pauses only
  Sonner's timer; it ends in a swipe or a release. Alternative: read Sonner's
  remaining time in JS each frame. Rejected: Sonner exposes no remaining
  time, and a parallel timer drifts from the one that closes the toast.
- **The bar is drawn by the host, not by each toast.** `ToastHost` wraps
  every toast's content with the bar when the duration is finite, so all
  toasts get it and none can forget it. Persistent (`Infinity`) gets none.
  The bar is keyed per show: a toast shown again by its id restarts
  Sonner's timer, so its bar starts again from full.
- **Reduced motion hides the bar** (`motion-reduce:hidden`). A static full
  bar would claim a time it does not show.
- **Success edge on format only.** The field marks a typed name that passes
  the same character rule Start checks (`PgExplorer.isWorkspaceNameValid`
  on the trimmed name, as `StartFromScratch.create` calls it); taken is known only on Start (Spec 09).
  `data-state="valid"` drives `border-success` so tests read a state, not a
  colour.
- **Message before the field.** `FieldError` moves ahead of the input: on
  its left in the one row (the prototype's place; above would be clipped by
  New project's scroll area and push the field off the chips' centre line),
  above it when the row stacks. `aria-describedby` already links it.
- **Lesson progress joins `ProjectEntry`.** `listProjects` takes a
  `progressOf(name)` dependency; `ProjectList` passes `useTutorialProgress`'s
  reader for lessons. `BaseProjectList` draws it in the marker slot with a
  described-by id, as it does the sync marker.
- **The open lesson's progress comes from memory.** `useTutorialProgress`
  re-reads on `PgTutorial.onDidChangePageNumber` and `onDidChangeCompleted`
  and takes the open lesson's page from `PgTutorial`, since its file is
  written after the change is announced. Memory counts only while the
  explorer holds that lesson's workspace (the guard `PgTutorial`'s storage
  uses); otherwise the file is read.

## Risks / Trade-offs

- [Sonner also pauses while a toast is pressed, which the bar does not
  follow] → the press ends in a swipe or a release within moments; the bar
  can only be off while a finger is on it.
- [Scenarios are unit-tested, not e2e] → each is marked `(manual)` and its
  unit test named in the plan; e2e is CI's job and no spec covers toasts or
  the list's progress yet.
- [Reversing R60] → Slava chose it on 2 Nov; the gap is in the designers'
  DES-194 review pack.
