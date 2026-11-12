# Proposal

## Why

The review of #306 (DES-196) left seven items open (HOO-2627). A second press of
**Use hosted model** counts a second pick, one telemetry value covers two
different buttons, the callout actions lent to an async button look different
from the plain ones beside them, and the sync banner leads with **Resolve…**
instead of the answer it expects.

## What Changes

- The refused key error drops **Change key** and **Use hosted model** once the
  thread has moved to another backend. With nothing connected, as after a
  reload, they stay.
- Telemetry: `assistant_connect_opened` gains `via: "use-hosted"` for a
  signed-out **Use hosted model**; `"key-rejected"` now means **Change key**
  only. No event is added, renamed or removed. `assistant_model_picked` is
  unchanged.
- The scenario "A 401 offers Enter key" is renamed for Change key, and two code
  comments are corrected.
- `CalloutAction` keeps one look when lent to an `AsyncButton`: no edge, no
  press nudge, and the callout's tone on hover in both themes. The design
  system's `callout` changes, installed with `yarn ds-add callout`.
- The sync banner lists its answers first and **Resolve…** after them, and the
  banner and the stopped notice put their buttons in `CalloutActions`, so the
  text above them reads at full strength. The sync slice's events are unchanged.
- Tests assert the phone sizes #306 set: 44px callout actions and head icons,
  48px model and effort buttons.

## Capabilities

### New Capabilities

### Modified Capabilities

- `assistant-own-key`: when the refused key error's buttons are offered, and the
  `via` values of `assistant_connect_opened`.

## Impact

- `client-v2/src/widgets/assistant`: the thread's actions, the stopped notice,
  telemetry, tests.
- `client-v2/src/features/persistence/Component/SyncBanner.tsx`: order and
  layout of its buttons; what each answer does is unchanged.
- `design-system/src/components/ui/callout.tsx`, installed into
  `client-v2/src/shared/ui`.
- Out of scope: the sync banner's titles and Rename (HOO-2552, on
  `scope/users-work`), which callouts use `CalloutAction` on other branches
  (#319, #320, #321), and the composer's sizes themselves.
