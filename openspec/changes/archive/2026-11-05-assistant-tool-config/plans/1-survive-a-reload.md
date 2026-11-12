# Survive a reload Implementation Plan

> **For agentic workers:** executed inline with superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the user's skill choices and MCP servers survive a reload as a delta, with no credential in storage.

**Architecture:** pure rules in `model/tool-config.ts`, state and write queue in `PgAssistant`, one file through `PgFs`.

**Tech Stack:** TypeScript, vitest in-source tests, Playwright.

**Spec:** `openspec/changes/assistant-tool-config/specs/assistant-tool-config/spec.md`, `design.md`.

## Global Constraints

- Path: `/.config/assistant-tools.json`. Nothing under `client-v2/api/`. No new telemetry event.
- Stored, never: `authToken`, `headers`, `queryParams`, `protection`, a query or login in `url`.

## Review Focus

- A write while the skills route is down, or before the list for this session answered: nothing is pruned.
- A write before the file was read: it waits for the read, so it cannot replace stored edits with an empty delta.
- A file that does not parse: reported, read as no edits, not rewritten until an edit.
- One invalid entry in `mcpServers`: only that entry is dropped.
- The read landing after `Grounding` mounted: a clean draft follows it, a dirty draft stays.

---

### Task 1: Rules, store, editor, e2e

**Files:**
- Create: `client-v2/src/views/sidebar/assistant/model/tool-config.ts`, `client-v2/e2e/assistant-tool-config.e2e.spec.ts`
- Modify: `client-v2/src/views/sidebar/assistant/store.ts`, `.../Component/Grounding.tsx`, `.../Component/Grounding.test.tsx`

**Interfaces:**
- `credentialsIn(server): CredentialField[]`
- `encodeToolConfig(state: ToolConfigState): string`, `decodeToolConfig(text: string): ToolConfig` (throws when not JSON)
- `readToolConfig(): Promise<ToolConfigRead>`, `writeToolConfig(text: string): Promise<void>`: report failures, never reject
- `PgAssistant.missingMcpCredentials: ReadonlyMap<string, readonly CredentialField[]>`

- [ ] **Step 1:** in-source tests of `tool-config.ts` over stubs: fail.
- [ ] **Step 2:** implement the rules: pass.
- [ ] **Step 3:** store tests (reload via fresh read, prune guards, write-before-read, corrupt file): fail, wire the store, pass.
- [ ] **Step 4:** `Grounding` tests (note, clean draft follows, dirty stays): fail, implement, pass.
- [ ] **Step 5:** e2e `assistant-tool-config: The stored file after adding a server with a token` and `A reload after turning a skill off and adding a server`, run with `USE_WASM_STUBS=true`: pass.
- [ ] **Step 6:** `yarn run check`, commit.
