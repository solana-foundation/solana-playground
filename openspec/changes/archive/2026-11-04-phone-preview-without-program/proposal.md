# Proposal

## Why

On a phone, a project with no program (only the Write stage) can never reach the pager's Preview page: the preview button sets the last preview stage, the flow holds such a project on Write, and the pager follows Write back to Code. The stage bar ("Client project") and the console with a client run's output are unreachable, which blocks the phone Run of HOO-2507 (Open the docs quickstart in Playground from a link and run it). Ticket: HOO-2583 (Phone: a project with no program reaches the Preview page).

## What Changes

- On a phone, the Preview page of a project with no program shows at Write and stays: the stage bar with the "Client project" label, and the console, which takes the page when open.
- Before anything has run, the console strip of a project with no program reads "Run the client to see its output here." (every width).
- A client run (the `run` command) in a project with no program opens the console, at every width, and on a phone moves the pager to Preview.
- Telemetry: no event added, renamed or removed. The run's move is reported by the existing `layout_page_shown` with `via: "auto"`, and the console's opening by `layout_panel_toggled` with `via: "auto"`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-without-program`: the requirement "A project with no program shows only the Write stage" gains the phone's Preview page, the console's hint and the run's console.

## Impact

- `client-v2/src/widgets/layout-shell` (the pager's page rules, the shell's run subscription, the phone console's height), `client-v2/src/views/flow/console/status.ts`.
- Out of scope: a project with a program (its preview and stages are unchanged), the Run button itself (HOO-2507), wide and compact layouts other than the console opening on a client run in a project with no program.
