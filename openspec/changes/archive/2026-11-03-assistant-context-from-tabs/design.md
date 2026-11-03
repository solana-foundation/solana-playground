# Design

## Context

See proposal.md, Why. Today three places decide what the model sees, and none of them limits it:

- `describeProject` (`views/sidebar/assistant/model/prompt.ts`) sends every path, the open tabs' names and the active tab in full, unless `TurnContext.openFile` is `false`.
- `list_files` and `read_file` (`model/tools.ts`) reach every file through `PlaygroundBridge`.
- The composer's chips (`widgets/assistant/ui/AssistantComposer.tsx`) mirror that, and `use-turn` holds the one-message "left out" path.

Tools run in the tab for every backend, the default one included (`api/agent.mjs` only proxies the model call), so a limit placed in the tab covers them all.

## Goals / Non-Goals

**Goals:**
- One source of truth for "the context", read by the prompt, by `read_file` and by the chips, so the three cannot disagree.
- The rule is enforced in the tool, not only by telling the model.

**Non-Goals:**
- Selections or line ranges as context.
- A persisted context. Reload starts from the open tabs, which the workspace already persists.

## Decisions

**A new entity slice, `entities/assistant-context`.** It holds the two sets the person chose (`added`, `removed`) per workspace, keyed by the workspace's stable id, and derives the context with a pure function `contextPaths(tabs, choice, exists)`: tabs in tab order, then added files in the order they were added, minus removed, minus files that no longer exist. The slice is an entity because it is a domain object that the widget, the bridge and the tools all read. The alternative was a `use-turn` state, as the old "left out" flag was, but the tools and the prompt run outside React and need to read it. The slice has no telemetry of its own. The widget sends the events.

**One choice per workspace, by stable id, in memory.** A removal is the person keeping a file from the model provider, so losing it sends that file again: the store keeps a choice per workspace (`Map`), keyed by `PgExplorer.currentWorkspaceId`, so visiting another project and coming back, or renaming the project, keeps it. A reload starts from the open tabs; nothing is persisted. A deleted file's choices are dropped (`forget`, on `PgExplorer.onDidDeleteItem`), so a new file made at the same path is not silently in the context.

**The bridge exposes the context, the prompt sends it.** `PlaygroundBridge` gains `listContextFiles()`. `ProjectContext` replaces `filePaths`, `openFilePaths` and `currentFileContent` with `contextFiles: { path, content }[]` and keeps `currentFilePath` to say which tab is active. `TurnContext` and its `openFile` flag are removed, together with `openFileLeftOut` and `leaveOutOpenFile` in `use-turn`. The removal is now the context store's job, and it outlasts a message.

**`read_file` checks the context, `list_files` goes.** Both file tools normalise the model's path with `bridge.toProjectPath` (the entity's pure `normalizeProjectPath`: `./`, `//`, `.`, `..`, backslashes, a leading `/` or the workspace prefix), so `/src/lib.rs` and `src/lib.rs` are the same file and a path leaving the project names nothing. The refusal is one exported string builder, so the test and the tool cannot drift apart. `write_file` still reads `before` locally for the approval card, which only the person sees; its "already contains exactly that content" answer is given only for a file in the context, since for any other it would confirm the model's guess at a file it may not read.

**Chips.** One chip per context file: label is the file's name, the tooltip is the relative path and "Sent in full with every message", accessible name is "Sent with this message: <name>, in full", and the remove button reads "Remove <name> from the context". The lesson, build-error and IDL chips stay as they are. The "N files" and "N open" chips go, because what they described is no longer sent.

**"Add a file" is a `DropdownMenuSub`** of the installed design-system dropdown, listing the files outside the context by relative path. A searchable picker for large projects waits on the designers (DES-196). Projects in the playground are tens of files, so a list is enough for now.

## Risks / Trade-offs

- [The model asks for files more often] → The behaviour prompt says how: name the file and ask the person to add it with +. The refusal text says the same.
- [Many open tabs make big requests] → They were opened by the person, and each chip can be removed. The old cost was the same for the active tab.
- [Lessons expect the model to read lesson files] → A lesson opens its files as tabs, so they are in the context.
- [The build error can name or quote a file outside the context] → Compiler output is sent as it is (the "build error" chip, `get_build_error`): it is the person's own build, shown to them, and cutting it per file is not reliable. Known limit, stated in `docs/assistant-context.md`; redaction is a follow-up.

## Migration Plan

Nothing is stored, so there is nothing to migrate. Rollback is a revert.
