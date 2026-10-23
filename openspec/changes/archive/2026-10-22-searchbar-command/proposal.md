# Proposal

## Why

`components/SearchBar`, the field with the generator list in the Interact
stage, is the last styled-components field there: it keeps the legacy look
beside fields already on the design system, and HOO-2077 (styled-components
out, `ui-migration` 5.24) cannot finish while it stays. This is HOO-2207,
`ui-migration` task 5.29.

## What Changes

- SearchBar renders from the design system: an input group for the field and
  a Command list in a Popover for its values, as the design system's
  `migration.tsx` row for SearchBar says ("Command inside a Popover"). The
  ticket's wording, an input group with the menu, gives way to that row
  (Slava, 2026-10-22, through Design alignment).
- Kept, as that row asks: pages that drill down, paste to pick, the last value
  restored; also the input's id, `onSearch`, `setSelectedItems` and a custom
  page (FromSeed's seed form). Its three users (`InstructionInput`,
  `FromSeed`, `Account`) change nothing.
- `searchButton.width` is removed from SearchBar's props: nothing passes it.
- `command` gets a registry entry in `design-system/registry.json` and is
  installed into `shared/ui`; `cmdk` becomes a `client-v2` dependency.
- No telemetry is added, renamed or removed: `components/` and `views/` are
  legacy roots, not slices.

## Capabilities

### New Capabilities

- `client-v2-search-field`: the field that offers values to pick, such as an
  Interact instruction's generators and an account's address.

### Modified Capabilities

None.

## Impact

- Code: `client-v2/src/components/SearchBar/`, `client-v2/src/shared/ui/command.tsx`,
  `design-system/registry.json`, `client-v2/package.json`,
  `client-v2/e2e/client-v2-stages.e2e.spec.ts`.
- Users see the Interact instruction inputs, FromSeed and the Accounts
  address field with the design system's field and list.
- Out of scope: the legacy `components/Input` (seven other users), the
  `Field`/`FieldError` move `migration.tsx` plans for validated inputs, and
  Combobox (Base UI), which would bring a second set of primitives.
