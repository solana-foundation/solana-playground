# Spec Delta

## Purpose

What a button does when pressed: the one call to action a screen offers,
waiting on the work it starts, copying a value, and reporting a click that
fails.

## ADDED Requirements

### Requirement: The one call to action carries the brand ring

A view SHALL show at most one brand button, for its one decisive action. Every
other button SHALL be flat. Buttons SHALL keep their labels, `aria-label`s and
test ids when they change kind.

#### Scenario: The Build stage offers Deploy as a brand button

- **WHEN** a build succeeds on the Build stage
- **THEN** the stage shows one brand button, labelled to go on to Deploy

### Requirement: A button that starts work waits for it

A button whose action runs until a promise settles SHALL be disabled and
marked busy until it settles, and SHALL say what it waits for where a text is
given. It SHALL accept clicks again once the work ends, whether the work
succeeded or failed.

#### Scenario: Build cannot be started twice

- **WHEN** a user presses Build and the build is still running
- **THEN** the Build button is disabled and busy, and a second press starts nothing

### Requirement: Copy says it copied

A copy button SHALL put its value on the clipboard and say "Copied" until the
message times out, then "Copy" again. If the clipboard refuses the value, it
SHALL NOT say "Copied".

#### Scenario: Copying a code block

- **WHEN** a user presses the copy button on a code block in a lesson or an assistant reply
- **THEN** the clipboard holds the block's code and the button says "Copied"

#### Scenario: A refused clipboard is not reported as copied

- **WHEN** the browser refuses to write to the clipboard
- **THEN** the button does not say "Copied", a toast says "Could not copy.", and the failure is logged

### Requirement: A failing click tells the user once

A click whose action fails SHALL tell the user what did not happen, in one
sentence naming the action ("Could not copy."), never the raw error. A failure
the action already showed (a terminal command printed it to the open console)
SHALL NOT be shown again; one printed into a folded console SHALL still be
told, except where the clicked place itself shows the failure: a Build or
Deploy run that leaves its stage failed is shown there, so its button toasts
nothing, folded console or not (Spec 08: one cause, one message). A run that
never starts, such as one with no terminal mounted to run it, is told by the
toast. Every failure SHALL still be logged under
`ui:button`, not marked for reporting (a user-caused or already-shown failure
must not reach error tracking), and the button SHALL stay usable.
A click whose action cannot run where it was clicked (a terminal command
while no terminal is mounted, as under Home) SHALL say so and name the way
out instead ("Can't build here: open a project to use the terminal.").

#### Scenario: A rejected action is logged (manual)

- **WHEN** a button's action rejects
- **THEN** the failure is logged under `ui:button`, not marked for reporting, a toast says what did not happen, and the button is enabled again

Covered by unit tests, not e2e, because the toast and the button's re-enabling together need an action that rejects on demand: `report-button-failure.test.tsx`, `terminal-process.test.ts`, `shared-ui-buttons.test.tsx`, `SyncBanner.test.tsx`, `ImportButton.test.tsx` and `use-turn.test.tsx`. The e2e tests for real failed clicks are the refused clipboard above and the two failed builds below; the folded-console rule is proven by `terminal-process.test.ts` ("does not mark a failure the folded console hid").

#### Scenario: A command clicked with no terminal mounted says how to run it (manual)

- **WHEN** a command is started from a click while no terminal is mounted (under Home)
- **THEN** a toast says "Can't <action> here: open a project to use the terminal.", the failure is logged under `ui:button`, and nothing waits on the terminal

The toast is covered by `report-button-failure.test.tsx` and `terminal-process.test.ts`; the e2e "a command allowed on Home fails within seconds" covers only that nothing waits on the terminal, through the assistant's build rather than a click.

#### Scenario: A failure the terminal printed is shown once

- **WHEN** a build started from the Build button fails while the console is open
- **THEN** the console shows the error and no toast appears

#### Scenario: A failed build is told once, by the Build stage

- **WHEN** a build started from the Build button fails while the console is folded
- **THEN** the Build stage says "Build did not start" and no toast appears
