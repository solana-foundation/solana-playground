# Proposal

## Why

HOO-2583 («Phone: a project with no program reaches the Preview page»)
shipped three behaviours its change did not specify before it was archived:
the terminal's welcome in a project with no program, the console opening when
the phone's Preview of such a project is entered, and the design system's key
hint hiding under a coarse pointer. A behaviour with no spec can change with
nothing to say it should not.

## What Changes

- The terminal's welcome in a project with no program names the client, not
  Build and Deploy, and is reprinted with the right wording once the program
  answer is known, until something is printed to the terminal.
- Entering the Preview of a project with no program on a phone opens the
  console. The opening is reported by the existing `layout_panel_toggled` with
  `via: "auto"`.
- The design system's key hint (`Kbd`) hides under a coarse pointer, wherever
  it is used. Menu shortcuts are not `Kbd` and are not covered.
- The scenarios are marked `(manual)`: this change adds no test.
- No code change: the behaviour already shipped with HOO-2583.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-without-program`: the requirement "A project with no program shows
  only the Write stage" gains the console's opening on the phone's Preview and
  the terminal's welcome; a new requirement "Kbd hides under a coarse
  pointer" joins the capability, since the ⌘J hint of the console strip is
  what raised it.

## Impact

- Spec only. The code it describes: `client-v2/src/widgets/layout-shell`,
  `client-v2/src/components/Terminal/Terminal.tsx`,
  `client-v2/src/utils/terminal/terminal.ts`,
  `design-system/src/components/ui/kbd.tsx` and its installed copy
  `client-v2/src/shared/ui/kbd.tsx`.
