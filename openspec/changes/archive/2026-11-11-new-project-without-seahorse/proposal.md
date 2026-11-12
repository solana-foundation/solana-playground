## Why

Seahorse is deprecated upstream, and a new project should not start from it.
The New project page's Start from scratch offered every framework the
Playground knows, Seahorse included, and the Home page's New project tile
named it ("Anchor, Native or Seahorse"). Requested on PR #505 (HOO-2795).

## What Changes

- Start from scratch offers Anchor and Native only, Anchor chosen by default.
- The Home page's New project tile reads "Anchor or Native".
- Seahorse stays a framework: existing Seahorse projects, its tutorials (the
  Tutorials page's Framework filter keeps it), import and export are
  unchanged, and the explorer's Create workspace modal still offers it.
- No telemetry events are added, renamed or removed; `new_project_started`
  keeps its `framework` parameter, which can no longer be `Seahorse` from
  Start from scratch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-layout`: a requirement that Start from scratch does not offer
  Seahorse.

## Impact

- `client-v2/src/features/new-project/ui/StartFromScratch.tsx` and its test;
  `client-v2/src/widgets/home/ui/BaseHome.tsx`.
- Out of scope: removing the Seahorse framework, its tutorials or its export
  profile; the explorer's Create workspace modal.
