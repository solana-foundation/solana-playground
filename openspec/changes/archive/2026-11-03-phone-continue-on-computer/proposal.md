# Proposal

## Why

On a phone a learner can read and run a project, but typing code, tests and a
local cluster want a computer. Nothing on the phone says how to take the work
there (designers' spec 15, "Continue on a computer"; DES-194 lists the link
among the parts dev builds for Breakpoint). HOO-2485.

## What Changes

- The phone's menu page gets a "Continue on a computer" row under the project
  list. It is drawn only below the phone breakpoint; the frame never shows it.
- The row opens a bottom sheet:
  - **Signed in:** the project is saved to the account; open the link on a
    computer and sign in with GitHub as the same login. The link, with Copy
    and, where the browser has a share sheet, Share.
  - **Signed out:** the project is saved on this phone only; "Sign in with
    GitHub" to carry it. The link still shows with Copy, for reading the
    project's tutorial or starting over there.
- The link is the app's address plus the current path, so a tutorial opens at
  that tutorial.
- Telemetry, `app-nav` slice: adds `nav_handoff_opened`,
  `nav_handoff_link_copied` and `nav_handoff_link_shared`. None renamed or
  removed.

## Capabilities

### New Capabilities

- `client-v2-handoff`: how a phone hands the session to a computer: where the
  way out shows, what the sheet says signed in and signed out, the link it
  gives, and its events.

### Modified Capabilities

None.

## Impact

- `client-v2/src/widgets/app-nav/`: a `BaseHandoff` + `Handoff` pair, a slot
  in `BaseAppNav` for the phone, three events.
- An e2e spec at phone width.
- Out of scope: saving the project to GitHub (spec 15 §G step 25 waits for
  GitHub sharing); the other two entries spec 15 names (a double tap on the
  code, Program Pal suggesting it); a short per-project or per-step link;
  carrying the conversation beyond what account sync already carries.
