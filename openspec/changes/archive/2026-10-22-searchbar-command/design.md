# Design

## Context

SearchBar (`components/SearchBar`) is a styled-components field with a list
that opens under it, built on the legacy `components/Input`. It filters as
you type, moves through the list with the arrow keys from the field, drills
down into nested lists, opens a custom page (FromSeed's seed form), picks an
item when its label is pasted, and puts back the last picked value on Escape
or a click outside when its user asks for that (`restoreIfNotSelected`). Its users after `ui-migration` 5.9 are
`InstructionInput`, `FromSeed` and `Account`. The design system's
`migration.tsx` gives its target, "Command inside a Popover"; the
prototype's `#app` has no new design for this field, so the reference is the
design system's Input group and Command blocks.

## Goals / Non-Goals

**Goals:**

- SearchBar imports nothing from styled-components.
- One focus ring, the input group's.
- Every behaviour above kept, with the props unchanged but for
  `searchButton.width`.

**Non-Goals:**

- Moving the legacy `components/Input` or adopting `Field`/`FieldError`.
- Changing what the generators offer.

## Decisions

- **The field is an `InputGroup`**: a search icon at the start, the input
  (`InputGroupInput`), and a clear button at the end once there is a value.
  The search icon stays a button (`aria-label="Search"`) that opens the list
  or picks the highlighted row, as the legacy one did. An error sets `aria-invalid` and shows its message
  above the field, as the legacy `Input` did.
- **The list is a `Command` in a `Popover`** anchored to the group
  (`PopoverAnchor`) and as wide as it. Over a list kept in the page's flow:
  the popover does not push the form down and is not clipped by the panel.
  Focus stays in the input when it opens (`onOpenAutoFocus` prevented);
  otherwise typing, the arrow keys and Enter, which act from the field,
  would stop working.
- **Command does not filter** (`shouldFilter={false}`); SearchBar's own
  `filter` and `matches` decide, as before. The highlighted row is Command's
  controlled `value`, set from SearchBar's keyboard index.
- **Combobox (Base UI) is not used**: it would bring a second set of
  primitives beside Radix.
- **A click outside** that lands in the popover is not outside: the popover
  renders in a portal, so the outside check covers the group and the popover
  content both.

## Risks / Trade-offs

- [cmdk handles keys on the Command root, and the field sits outside it, in
  the popover's anchor] → the highlighted row is driven from SearchBar's
  existing key handling through Command's `value`, so cmdk's keyboard
  handling is not relied on.
- [The popover renders in a portal on `body`, so it outlives a field the
  layout keeps mounted but takes away (off the page under Home, `inert` under
  a page)] → SearchBar closes the list when its field leaves the viewport or
  turns inert.
- [A custom page (FromSeed's) can be taller than the room left] → the
  popover is capped at Radix's available height and scrolls.
- [A popover inside the Interact panel's scroll] → Radix repositions on
  scroll and collision; the screenshots at 1280, 834 and 390 px check it.
