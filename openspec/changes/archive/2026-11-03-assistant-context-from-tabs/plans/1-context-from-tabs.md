# Context from open tabs plus "Add a file": implementation plan

> **For agentic workers:** run inline with superpowers:executing-plans (fleet rule: subagents only for large plans). Steps use checkboxes.

**Goal:** The assistant's context becomes the open tabs plus the files the user adds, minus the ones the user removes. Nothing else reaches the model.

**Architecture:** A pure entity slice `entities/assistant-context` holds the user's choice (added, removed) for one workspace and derives the context paths. The bridge reads it for the prompt and for `read_file`. The composer reads it for the chips and writes it from the + menu and from each chip's remove button.

**Tech stack:** React 19, Vitest (in-source blocks plus RTL test files), Playwright, the design-system `DropdownMenuSub`.

**Spec:** `openspec/changes/assistant-context-from-tabs/` (proposal, design, specs).

## Global constraints

- Accessible names, verbatim: `Sent with this message: <name>, in full` and `Remove <name> from the context`. Menu item `Add a file`. Empty submenu note `Every file is in the context`.
- Telemetry: `assistant_context_file_added` with `{ via: "menu" }`. `assistant_file_chip_removed` with no params.
- Paths are relative to the project root (`src/lib.rs`), as the bridge's `toRelative` gives them. `.workspace/` files are never offered.
- Run commands with Node 22 (`PATH=~/.nvm/versions/node/v22.23.4/bin:$PATH`), from `client-v2/`.

## Review focus

1. The model passes `/src/lib.rs` or `./src/lib.rs`. `read_file` must treat it as `src/lib.rs`, in or out of the context alike (task 3 test).
2. A file is removed while its tab stays open. It must stay out after the next tab switch (task 1 test: tabs do not override `removed`).
3. An added file is deleted or renamed. It must leave the context and must not be sent as empty content (task 1 test: the `exists` filter).
4. Re-adding a removed open tab must bring it back at its tab position, not duplicate it (task 1 test).
5. The workspace switches. Its choice must not leak into the other project (task 1 test: `choice` is keyed by workspace).

---

### Task 1: `entities/assistant-context`

**Files:** create `src/entities/assistant-context/index.ts` and `src/entities/assistant-context/model/context.ts` (in-source tests).

**Produces:**
- `interface ContextChoice { readonly added: readonly string[]; readonly removed: readonly string[] }`
- `contextPaths(tabs: readonly string[], choice: ContextChoice, exists: (path: string) => boolean): string[]`. Tabs in order, then added in order, without duplicates, minus `removed`, minus paths for which `exists` is false.
- `PgAssistantContext.choice(workspace: string | null): ContextChoice`, one per workspace (a `Map` keyed by the stable workspace id), empty until a choice is made there.
- `PgAssistantContext.forget(workspace, path)`: drops every choice about `path` and what is under it (a deleted file).
- `normalizeProjectPath(path: string): string | null`: `./`, `//`, `.`, `..`, backslashes, a leading `/`; `null` for empty or leaving the project.
- `PgAssistantContext.add(workspace, path)`: drops `path` from `removed`, and appends it to `added` unless it is there already.
- `PgAssistantContext.remove(workspace, path)`: drops it from `added` and adds it to `removed`.
- `PgAssistantContext.onDidChange(cb): { dispose(): void }`.

- [ ] Tests: order (tabs, then added), dedupe of a tab that is also added, removal of a tab, re-add puts it back at its tab position, the `exists` filter, the workspace switch, and `onDidChange` firing on add and on remove.
- [ ] Run `yarn test-unit src/entities/assistant-context/model/context.ts` and see it fail. Implement. Run again and see it pass. Commit.

### Task 2: Bridge and prompt

**Files:** `src/views/sidebar/assistant/bridge/playground-bridge.ts`, `model/prompt.ts`, `model/prompt.test.ts`, `model/types.ts`, `model/provider.ts`.

**Produces:**
- `PlaygroundBridge.listContextFiles(): string[]`
- `PlaygroundBridge.toProjectPath(path: string): string | null` (normalises the model's path; `null` names nothing in the project)
- `ProjectContext.contextFiles: { path: string; content: string }[]`, which replaces `filePaths`, `openFilePaths` and `currentFileContent`. `currentFilePath` stays.
- `TurnContext` and the `context` argument of `Provider.send` are removed. `describeProject(bridge?)`.

- [ ] Test (`prompt.test.ts`): a stub bridge with two context files and `listFiles` holding a third, `secret.rs`. The output holds both contents, the line `Files in context (open tabs and files the user added; you can read only these): a, b`, and `Active tab: a`. It does not contain `secret.rs`.
- [ ] Fail, implement, pass. Also fix `use-turn`'s callers of `send(…, context)` in task 4, or drop the argument here and in task 4 together. Commit.

### Task 3: Tools and registry

**Files:** `src/views/sidebar/assistant/model/tools.ts`, `tools.test.ts`, `tools-registry.test.ts`, `src/entities/agent-tools/model/registry.mjs`, `registry.test.mjs`, the `BEHAVIOUR` text in `prompt.ts`.

**Produces:** `notInContext(path: string): string`, exported from `tools.ts`, giving: `` `${path} is not in this conversation's context, so you cannot read it. Ask the user to add it with + in the composer (Add a file), then read it.` ``

- [ ] Tests: `read_file` on an in-context path returns the content. On `/src/lib.rs` it does the same when `src/lib.rs` is in context. On an out-of-context path it returns `notInContext(path)` and no content. `list_files` is not among the tools. The registry has exactly the eight names.
- [ ] Fail, implement, pass. The `read_file` description becomes: "Read one file in the conversation's context: the user's open tabs and the files they added. Any other file is refused; ask the user to add it with + in the composer. Always read a file before proposing a change to it." BEHAVIOUR gains one bullet: "You see only the files in the conversation's context. If you need another file, name it and ask the user to add it with + in the composer; never guess its content." Commit.

### Task 4: Composer and turn

**Files:** `src/widgets/assistant/ui/AssistantComposer.tsx`, `BaseAssistantComposer.tsx` and its tests, `model/use-turn.ts` and its test, `model/telemetry.ts`.

**Consumes:** `PgAssistantContext` and `contextPaths` (task 1), `realBridge.listContextFiles()` and `listFiles()` (task 2).

**Produces:** `BaseAssistantComposer` prop `addable: { path: string; add(): void }[]` rendered as `DropdownMenuSub` "Add a file". An empty list renders the note `Every file is in the context`.

- [ ] Tests (RTL, memory telemetry provider): a chip per context file with the spoken name. The remove button calls `PgAssistantContext.remove` and tracks `assistant_file_chip_removed`. The "Add a file" submenu lists the addable files, and picking one adds it and tracks `assistant_context_file_added { via: "menu" }`. The "N files" and "N open" chips are gone. `use-turn` sends no context argument.
- [ ] Fail, implement (the composer also re-renders on `PgAssistantContext.onDidChange`, `PgExplorer.onDidSetTabs` and `onDidSwitchWorkspace`), pass. Commit.

### Task 5: e2e

**Files:** `e2e/client-v2-assistant.e2e.spec.ts`.

- [ ] `assistant-composer-context: Only the context reaches the model`. Stub `/api/agent` and capture the POST bodies. The default Anchor project opens `src/lib.rs` alone: add `client/client.ts` through the menu and send. The body carries the text unique to `lib.rs` and `client.ts`, and neither `tests/anchor.test.ts` nor its unique text (the tool declarations name `src/lib.rs` as an example, so paths alone prove nothing).
- [ ] `assistant-composer-context: Remove an open tab from the context`: remove `lib.rs`, send two messages, and neither body contains `src/lib.rs`.
- [ ] `assistant-composer-context: Add a file that is not open`: add via the menu, see the chip and the telemetry line.
- [ ] Run `yarn test-e2e e2e/client-v2-assistant.e2e.spec.ts -g assistant-composer-context`. Commit.

### Task 6: Docs

- [ ] Update the "Project context" bullet in `docs/assistant-context.md`. Run `yarn sync-assistant-context`. Commit.
