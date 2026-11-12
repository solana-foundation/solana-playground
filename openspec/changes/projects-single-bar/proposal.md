# Proposal

## Why

A project shows two bars over the code: the stage bar (project name, Share,
the assistant's toggle, ⋯) above Write / Build / Deploy / Interact, and the
editor head (tabs, Files, Terminal) under it. The assistant's toggle repeats
the assistant's own collapse button, and the file tree is a fourth column
unlike the tutorial's tree with its pin. Almaz decided the layout in the
Slack thread of 12 Nov (16:43–17:24); HOO-2827 carries it out before the
13 Nov handover.

## What Changes

- **One bar.** A project no longer draws the stage bar over its work column.
  The editor head is the one row: file tabs on the left; Files, Terminal,
  Share and ⋯ (Solana documentation) on the right. Home and the cover pages
  keep their bar.
- **The chat comes back from the row.** The row holds an "Expand assistant"
  button only while the assistant is hidden; the assistant's own "Collapse
  assistant" button hides it.
- **The project names the chat.** The assistant's head reads the open
  project's name instead of "Assistant · {model} · hosted"; the model's name
  stays in the composer's model button. With no project open it names the
  model as before.
- **The stage tabs row** is 44 px with its own line, meeting the
  assistant's head.
- **Built on Almaz's commit** 6f4c97f3b (`almaz/project-one-bar`), which
  carries the one bar, the chat toggle and the chat head; this change adds
  the tree and the specs.
- **The tutorial's tree shell for the project tree.** The project tree
  docks beside the editor by default (the column, as now) with the
  tutorial's unpin at its top; Files in the row undocks it, and from then on
  Files opens it as a dropdown under the row with the tutorial's pin «Dock
  beside the editor». The pin shows only while the code area is wider than
  1100 px; narrower, a docked tree shows as the dropdown. The choice is
  remembered in the saved layout.
- **Telemetry.** `layout_panel_toggled` keeps `panel: "files"` and now means
  docked (`open: true`) or undocked; `via` gains no value. One event is
  added: `layout_files_dropdown_opened` with `via: "button" | "key"`, sent
  when the dropdown opens. Unchanged: `layout_panel_toggled` for the
  assistant (now from the row's Expand button) and every tutorial event. No
  funnel step's code is touched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-editor-head`: the head becomes the project's only bar; Files
  docks and undocks the tree; the tree starts docked.
- `assistant-model-name`: the head names the project while one is open.
- `assistant-ai-gate`: the off status sits after the head's title.
- `client-v2-layout`: a project draws no stage bar; the chat's reopen lives
  in the editor head; the stage tabs row is 44 px.

## Impact

- Code: `widgets/layout-shell` (LayoutShell, BaseLayoutShell,
  BaseEditorHead, layout-state defaults, telemetry), `widgets/assistant`
  (head label), `widgets/tutorial-workspace` (pin and unpin pulled into a
  shared piece both trees use), `views/flow` (Flow passes Share to the head).
- Tests: unit tests of the stage bar, layout shell, editor head and the
  assistant's head; the e2e specs `client-v2-layout`, `client-v2-editor-head`,
  `first-run`, `files`, `composer-regrow`, `assistant-reconnect`.
- Out of scope: Write / Build / Deploy / Interact (stay under the row as
  they are); keyboard shortcuts in Projects (a parallel ticket; ⌘E keeps
  calling the same files toggle); the tutorial frame and its chat head; the
  phone layout (below 768 px, unchanged); moving the project tree's body
  (folders, context menu, rename, drag) into the tutorial's flat list.
- The `ui-migration` change's 5.25 requirement "a bar over each column" is
  superseded for the project's work column by this change; the umbrella's
  text is left to its owner.
