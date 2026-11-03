## Why

The design review of the components dev built from design system parts (DES-194) found states that read wrong: AI Off
counted as a failure, offline drawn red in one place and yellow in another, every Interact field shown as a list,
the phone's "Continue on a computer" sitting among the projects, and a name field that jumped when its message
showed. The fixes are in the code; the specs still describe the old behaviour.

## What Changes

- Status: four states instead of three. A wait (offline, a cluster that does not answer, a slow analyzer) is the
  warning colour everywhere; red is kept for a real failure (the analyzer threw). AI Off and an analyzer that has
  not started are grey and are left out of the phone chip's count. The rail's dots get tooltips and a 44 px
  target under a finger. The stage notice gets a Dismiss button.
- Search field: Interact's Random is a button inside the field, not a row in the list. A field whose only pick is
  Random (a number) is a plain textbox with no list; a chevron shows only where there is a choice; a magnifier only
  where the caller asks for search.
- Handoff: "Continue on a computer" is its own group at the foot of the menu page, not under Projects. Signed out,
  the sheet offers only "Sign in with GitHub": no link, Copy or Share, since a computer would open the link without
  the project.
- Start from scratch: the name message shows under the field, and a valid name gets no success edge.
- Telemetry: adds `status_notice_dismissed { notice }` in the `status` slice. No other event is added, renamed or
  removed; `nav_handoff_link_copied` and `nav_handoff_link_shared` now fire only signed in, because only then are
  Copy and Share shown.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-status`: the indicator states, the phone chip's count, the rail dots and the notice's Dismiss.
- `client-v2-search-field`: Random as an inline button and fields without a list.
- `client-v2-handoff`: where the row sits and what the signed-out sheet offers.
- `client-v2-layout`: where the project name's message shows and the dropped success edge.

## Impact

- Code: `widgets/status`, `components/SearchBar`, `views/sidebar/test` (Interact's instruction card),
  `widgets/app-nav` (handoff), `features/new-project`, and design system parts reinstalled with `yarn ds-add`
  (sonner, callout, stage-empty, input, drawer, brand-button, theme).
- Tests: unit tests and the e2e specs for stages, status, handoff, home and new project are updated.
- Out of scope: the DES-206 share flow and its stand (`scope/typescript-2`), the cool palette (its own branch), the
  Account and Event cards' contents beyond the shared card header.
