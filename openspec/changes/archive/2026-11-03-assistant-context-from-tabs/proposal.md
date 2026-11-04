# Proposal

## Why

Every assistant turn sends the path of every project file and the active tab
in full, and `list_files` and `read_file` let the model read any file. In
effect the whole project goes to the model provider, which is more of the
user's code than a question needs. The 29 Oct security review asked that the
user decide what goes. Slava settled the rules on 3 Nov
([HOO-2424](https://linear.app/solana-fndn/issue/HOO-2424)).

## What Changes

- The assistant's context is every open tab, plus files the user adds
  through the composer's + menu ("Add a file"), minus files the user
  removed. Only those files reach the model.
- **BREAKING (model-facing):** the project-state message sends every file in
  the context in full and names no other path. It no longer sends the
  project's file list or the open tabs' names.
- **BREAKING (model-facing):** `read_file` refuses a path outside the
  context and tells the model to ask the user to add it with +. `list_files`
  is removed. `write_file` keeps writing any path, behind the user's approval.
- The composer shows one chip per file in the context, each with a remove
  button. Removing a file keeps it out until it is added back. The old
  "Leave <file> out of the next message" (one message only) goes, and so do
  the "N files" and "N open" chips.
- The + menu gains "Add a file", a submenu that lists the project files not
  in the context.
- Added and removed files are kept per project while the page is open, across a switch to another project and back. A reload starts from the open tabs. Deleting a file drops the choices about it.
- Telemetry (widget `assistant`): adds `assistant_context_file_added`
  (`via: "menu"`). `assistant_file_chip_removed` keeps its name and gains no
  parameters, and now fires for any file chip.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assistant-composer-context`: the chips list the files in the context, any
  of them can be removed until it is re-added, and the + menu gains
  "Add a file". This replaces "The open file can be left out of the next
  message".
- `assistant-tool-registry`: the built-in tools drop `list_files`, and
  `read_file`'s description says it reads only files in the context.

## Impact

- Code: `src/views/sidebar/assistant/{bridge,model}` (project state, tools),
  `src/entities/agent-tools` (registry), `src/widgets/assistant`
  (composer, turn), and a new `src/entities/assistant-context` slice holding
  the added and removed sets.
- `docs/assistant-context.md` changes, and the in-product copy is re-synced.
- User-visible: the assistant knows less unasked. For a file that is not
  open, the assistant now asks the user to add it rather than reading it.
- Out of scope: selections or line ranges as context (the editor's
  "Explain/Fix with Program Pal" chip), a searchable picker for big
  projects (asked of the designers with DES-196), persisting the context
  across reloads, and any server-side change. The default backend's route
  runs the same client-side tools, so it gets the same limits.
