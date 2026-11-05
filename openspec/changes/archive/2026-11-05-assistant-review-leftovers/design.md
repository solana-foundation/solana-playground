# Design

## Context

`CalloutAction asChild` hands its classes to an `AsyncButton`, which renders a
`Button` with `variant="ghost" size="sm"`. `tailwind-merge` drops the classes
that clash exactly, so `h-7` and `hover:bg-muted` go. Button's `border`,
`bg-clip-padding`, press nudge, `hover:text-foreground` and `dark:hover:bg-muted/50`
stay, because no class in `CalloutAction` carries the same variant.

#319, #320 and #321 bring the same `asChild` call sites to other branches.

## Goals / Non-Goals

**Goals:** fix the look in `callout.tsx` alone, so no call site changes.

**Non-Goals:** a new Button variant; an async `CalloutAction`.

## Decisions

**The fill is two custom properties set by tone.** `CalloutAction` reads
`--action-rest` and `--action-hover`, and each tone sets them. `hover:` and
`dark:hover:` both read `--action-hover`, so `dark:hover:` displaces Button's
dark hover in `tailwind-merge` and no tone has to win a specificity tie against
it. Rejected: repeating every tone under `dark:hover:`, which doubles the class
list and still depends on stylesheet order.

**"Moved" means connected to a different backend.** The buttons drop when a
connection exists and its id differs from the refused provider. Comparing only
with the hosted model would leave them after a pick from the composer's menu.
No connection is not a move: the key lives in memory, so a reload ends there
with the refusal still unanswered.

## Risks / Trade-offs

- A callout with `CalloutAction` on another branch conflicts in `callout.tsx`
  when it rebases over this; taking this version is correct, since the API is
  unchanged.
