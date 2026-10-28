# Plain TypeScript Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repository or gist with no program but with TypeScript imports
as a project with no program, and such a project's stepper shows only
Write.

**Architecture:** The layout rule and the "has a program" check live on
`PgFramework` (`utils/framework.ts`), so repository import, the catalog and
the `/{githubUrl}` route all get it through `convertToPlaygroundLayout`. Gist
import replaces its framework check with "a program, or TS/JS under
`client/`/`tests/`". `FlowState` gains `hasProgram`; the reducer keeps the
stage on Write while it is false, and the stepper and keybinds read
`stagesOf(state)`.

**Tech Stack:** TypeScript, React 17, vitest (in-source blocks), Playwright.

**Spec:** `openspec/changes/plain-typescript-import/` (proposal, design,
`specs/project-without-program/spec.md`, `specs/gist-sharing/spec.md`).

## Global Constraints

- TS/JS extensions: `ts`, `tsx`, `js`, `jsx`. Test file: `/\.(test|spec)\.[jt]sx?$/`.
- "Has a program": a path `src/<anything>.rs` or `src/<anything>.py`, relative to the project root.
- Stepper tab ids stay `flow-stage-tab-<stage>`; hidden tabs are not rendered.
- No new telemetry event; `gist_import_failed` keeps `reason: no-program`.
- Unknown-framework error text stays `"Could not identify framework"`.
- No nested ternaries; no empty `catch`; tests do not spread to build shapes (AGENTS.md).

## Review Focus

- A repository whose TS sits under `client/` (`client/index.ts`) must land at `client/index.ts`, never `client/client/index.ts`.
- `PgExplorer.files` holds folders (keys ending `/`) and full paths `/<ws>/src/...`; the check must use relative paths, and a temporary (link) view has no workspace prefix.
- A `src/` file nested deeper (`src/instructions/mod.rs`) still counts as a program.
- A workspace switch resets `FlowState` to `INITIAL_FLOW_STATE`; `hasProgram` must be recomputed after the reset, not before.
- A terminal `build` on a no-program project must not leave `stage: "build"` (panel with no tab).

---

### Task 1: `PgFramework.hasProgram` and the no-program layout

**Files:**
- Modify: `client-v2/src/utils/framework.ts` (`convertToPlaygroundLayout`, new statics; tests in its in-source block)

**Interfaces:**
- Produces: `PgFramework.hasProgram(paths: string[]): boolean` (relative paths);
  `PgFramework.hasRunnableTypeScript(paths: string[]): boolean` (a TS/JS path under `client/` or `tests/`);
  `convertToPlaygroundLayout(files)` returns the no-program layout when no framework matches and TS/JS exists.

- [ ] **Step 1: Write failing in-source tests** under `describe("PgFramework.convertToPlaygroundLayout")`:
  - `"lays out a client and its tests"`: `[["index.ts","a"],["lib/rpc.ts","b"],["tests/rpc.test.ts","c"]]` → paths `["client/index.ts","client/lib/rpc.ts","tests/rpc.test.ts"]` (sorted compare).
  - `"keeps folders and drops other kinds"`: `src/app/main.ts`, `test/unit/math.ts`, `client/run.ts`, `README.md`, `package.json` → `["client/run.ts","client/src/app/main.ts","tests/unit/math.ts"]`.
  - `"puts a spec file outside tests under tests"`: `lib/math.spec.ts` → `["tests/lib/math.spec.ts"]`.
  - `"still refuses a repository with neither"`: `[["README.md","x"]]` rejects with `"Could not identify framework"`.
  - `"leaves an Anchor repository to Anchor"`: `programs/p/src/lib.rs` containing `#[program]` plus `app/x.ts` → result contains `src/lib.rs` (Anchor's conversion ran).
  - `hasProgram`: true for `src/lib.rs`, `src/instructions/mod.rs`, `src/x.py`; false for `client/x.ts`, `client/src/lib.rs`, `src/notes.md`.
- [ ] **Step 2: Run** `yarn test-unit src/utils/framework.ts` — expect the new cases FAIL.
- [ ] **Step 3: Implement** a module-private `toNoProgramLayout(files: TupleFiles): TupleFiles` (drop non-TS/JS; strip a leading `client/`, `tests/` or `test/`; `tests/` when the stripped prefix was `tests/`/`test/` or the name matches the test regex, else `client/`), the two statics, and the fallback in `convertToPlaygroundLayout` before the throw.
- [ ] **Step 4: Run** the same command — PASS.
- [ ] **Step 5: Commit** `feat(client-v2): import a repository with no program as TypeScript (HOO-2147)`.

### Task 2: Gist import accepts a TypeScript gist

**Files:**
- Modify: `client-v2/src/features/gist/model/import.ts` (`layOut`)
- Test: `client-v2/src/features/gist/model/import.test.ts`

**Interfaces:**
- Consumes: `PgFramework.hasRunnableTypeScript(paths)` from Task 1.

- [ ] **Step 1: Failing tests:** `"opens a hand-made gist of TypeScript"` — gist `{ "client.ts", "client.test.ts" }` resolves with files `client/client.ts`, `tests/client.test.ts`, layout `loose`, and the memory provider holds `gist_import_succeeded` with `layout: "loose"`. Update the existing no-program case(s) to a gist holding only `notes.md`, expecting `reason: "no-program"` and the message `"This gist holds no Solana program and no TypeScript or JavaScript to open."`.
- [ ] **Step 2: Run** `yarn test-unit src/features/gist/model/import.test.ts` — FAIL.
- [ ] **Step 3: Implement:** refuse only when `!getFromFiles(...) && !hasRunnableTypeScript(paths)`; the new message for both `no-program` throws in `layOut`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client-v2): open a gist of TypeScript with no program (HOO-2147)`.

### Task 3: Only Write for a project with no program

**Files:**
- Modify: `client-v2/src/views/flow/state/stage.ts`, `client-v2/src/views/flow/header/Stepper.tsx`, `client-v2/src/views/flow/header/StageBar.tsx`
- Test: `client-v2/src/views/flow/state/stage.test.ts`, `client-v2/src/views/flow/header/Stepper.test.tsx`

**Interfaces:**
- Consumes: `PgFramework.hasProgram`.
- Produces: `FlowState.hasProgram: boolean` (initial `true`); event `{ type: "program"; has: boolean }`; `stagesOf(state: FlowState): readonly Stage[]`.

- [ ] **Step 1: Failing reducer tests:** `program` false from `stage: "build"` → `stage: "write"`; `set-stage` `deploy` while false → stage unchanged; `build-start` while false → stage `write`, `build: "running"`; `program` true → `stagesOf` equals `STAGES`; `workspace-change` keeps nothing but `INITIAL_FLOW_STATE`. `init` test: after the mocked `onDidSwitchWorkspace` fires with `PgExplorer.files` = `{"/ws/client/a.ts":{content:""}}`, `PgFlow.state.hasProgram` is false.
- [ ] **Step 2: Failing Stepper test** `"shows only Write for a project with no program"`: render with `hasProgram: false` → only `#flow-stage-tab-write` exists.
- [ ] **Step 3: Run** both test files — FAIL.
- [ ] **Step 4: Implement:** reducer cases; `init` dispatches `program` from `PgExplorer.onDidInit`, after `workspace-change` in the switch handler, and from `onDidCreateItem`/`onDidDeleteItem`/`onDidRenameItem`, computed as `PgFramework.hasProgram(Object.keys(PgExplorer.files).map((p) => PgExplorer.getRelativePath(p)))`, guarded to no-op when no workspace is open. Stepper maps `stagesOf(state)`; StageBar binds `Ctrl+1..4` only for `stagesOf(PgFlow.state)` at key time.
- [ ] **Step 5: Run** — PASS; `yarn test-types`.
- [ ] **Step 6: Commit** `feat(client-v2): show only Write for a project with no program (HOO-2147)`.

### Task 4: e2e scenarios

**Files:**
- Create: `client-v2/e2e/project-without-program.e2e.spec.ts`
- Modify: `client-v2/e2e/gist-import.e2e.spec.ts`

- [ ] **Step 1:** Repository specs stub `https://api.github.com/repos/<o>/<r>/git/trees/**` and `https://raw.githubusercontent.com/**` (pattern as in `gist-import`'s repository case), import through the dialog, and assert the explorer's file rows and the stepper tabs. Titles: `project-without-program: A client and its tests`, `…: Folders are kept`, `…: A test file outside a tests folder`, `…: A repository with neither`, `…: An imported TypeScript project`, `…: A program is added`. Gist: `gist-sharing: A hand-made gist of TypeScript`, `gist-sharing: A gist with nothing to open`.
- [ ] **Step 2: Run** `yarn test-e2e e2e/project-without-program.e2e.spec.ts e2e/gist-import.e2e.spec.ts` — PASS.
- [ ] **Step 3: Commit** `test(client-v2): e2e for importing a project with no program (HOO-2147)`.
