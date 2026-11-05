# Gist export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share a project as a public gist from its navigation menu, with a format HOO-1761 reverses.

**Architecture:** A pure format module in `features/gist/lib`, a server route `api/gists.mjs` that holds the GitHub token, and a Base + connected dialog opened by `widgets/app-nav`, which also supplies sign-in (a feature cannot import `auth`).

**Tech Stack:** React 19, Vitest in-source tests, `node --test` for `api/`, Better Auth 1.7.

**Spec:** `openspec/changes/gist-export/specs/gist-sharing/spec.md`, `design.md` beside it.

## Global Constraints

- Manifest name `.playground.json`, shape `{"version":1,"name","files":{gistName:path},"empty":[path]}`.
- Flat name: path with `/` -> `__`; clash -> `-2`, `-3` before the extension; assigned in sorted path order.
- Never exported: `.workspace/**`, root `.tutorial.json`.
- Limits: 4 MB total (UTF-8 bytes of contents), 300 files (manifest not counted).
- `GistFormatError.reason`: `invalid-manifest | unsupported-version | unsafe-path | missing-file | no-supported-files`.
- Telemetry prefix `gist`; failure reasons `too-large | signed-out | sign-in-failed | needs-gist-scope | github-unauthorized | rate-limited | rejected | request-failed`.
- Logger namespaces `gist:export`, `gist:server`.
- Rules from `client-v2/CLAUDE.md` and `AGENTS.md`: in-source tests, no spreads in tests, no empty catch, no nested ternaries, `reportButtonFailure` on every `AsyncButton`/`CopyButton`.

## Review Focus

- A project with a file literally named `.playground.json` at its root: it must survive the round trip (gets `.playground-2.json`). Test in Task 1.
- A file whose name has no extension (`Makefile`) or two dots (`a.test.ts`) when clashing: the suffix goes before the last extension only (`a.test-2.ts`). Test in Task 1.
- Non-ASCII content: the 4 MB limit counts UTF-8 bytes, not string length. Test in Task 1.
- GitHub `403` from rate limiting (has `x-ratelimit-remaining: 0`) must map to `429`, not to "needs scope". Test in Task 2.
- The sign-in popup blocked by the browser: dialog shows the reason, not a crash. Test in Task 3.

---

### Task 1: Gist format

**Files:**
- Create: `client-v2/src/features/gist/lib/format.ts` (in-source tests)
- Create: `client-v2/src/features/gist/index.ts`

**Interfaces:**
- Produces:
  - `MANIFEST_NAME = ".playground.json"`, `MAX_GIST_BYTES = 4 * 1024 * 1024`, `MAX_GIST_FILES = 300`
  - `isExportablePath(path: string): boolean` (path relative to the project root, no leading `/`)
  - `type GistFiles = Record<string, { content: string }>`
  - `toGistFiles(project: { name: string; files: Record<string, string> }): GistFiles` (drops non-exportable paths, adds manifest)
  - `fromGistFiles(files: GistFiles): { name: string | null; files: Record<string, string> }`
  - `class GistFormatError extends Error { reason: GistFormatReason }`
  - `measureGist(files: GistFiles): { bytes: number; files: number }`

- [ ] Step 1: tests: `round trip keeps paths, contents and name`; `nested paths become __ names`; `a clash gets -2 before the extension, deterministically`; `a root .playground.json survives`; `empty files go to the manifest only`; `.workspace and .tutorial.json are never exported`; one test per error reason; `a hand-made gist is placed by kind` (`lib.rs`→`src/lib.rs`, `app.test.ts`→`tests/app.test.ts`, `client.ts`→`client/client.ts`, `notes.docx` dropped); `measureGist counts UTF-8 bytes`.
- [ ] Step 2: run `yarn test-unit src/features/gist/lib/format.ts`; expect failures.
- [ ] Step 3: implement. Hand-made placement uses `PgLanguage.getFromPath` from `@/utils/language` (deep import: the `utils` barrel pulls in webpack globals).
- [ ] Step 4: tests pass; `yarn test-types` clean.
- [ ] Step 5: commit `feat(client-v2): gist format for sharing a project`; tell the HOO-1761 session the sha.

### Task 2: Server route

**Files:**
- Create: `client-v2/src/features/gist/server.mjs`
- Create: `client-v2/api/gists.mjs`, `client-v2/api/gists.test.mjs`

**Interfaces:**
- Produces: `createGist({ token, description, files, fetch? }): Promise<{ status: number; body: object }>` mapping GitHub's answer per the spec's route requirement; `POST /api/gists` body `{ description: string, files: GistFiles }` → `201 {url, id}` or `{status, reason}`.
- Consumes: `readSession`, `getAuth`, `isAllowedOrigin` from `features/auth/server.mjs`.

- [ ] Step 1: tests in `api/gists.test.mjs` with an injected fetch and session: 405 non-POST; 403 other origin; 401 signed-out (no GitHub call); 503 unconfigured/unavailable; 400 malformed body; 413 over limit; 201 success (asserts `public: true` sent, token in `authorization: Bearer`); 403 `needs-gist-scope` (GitHub 404 + `x-oauth-scopes: read:user, user:email`); 429 (GitHub 403 + `x-ratelimit-remaining: 0`, and GitHub 429); 401 `github-unauthorized` (GitHub 401); 422 (GitHub 422); 502 (GitHub 500, network error); response body never contains the token.
- [ ] Step 2: run `yarn test-api`; expect failures.
- [ ] Step 3: implement; the handler takes its dependencies through a `createHandler(deps)` export so tests inject them, `default` wires the real ones.
- [ ] Step 4: tests pass; lint clean.
- [ ] Step 5: commit `feat(client-v2): POST /api/gists creates a public gist with the user's token`.

### Task 3: Sign-in scopes, export model, dialog

**Files:**
- Modify: `client-v2/src/features/auth/model/session.ts` (`signIn({ from, scopes })`)
- Create: `client-v2/src/features/gist/model/export.ts`, `model/telemetry.ts`
- Create: `client-v2/src/features/gist/ui/BaseShareGistDialog.tsx` (+ `.test.tsx`), `ui/ShareGistDialog.tsx`
- Modify: `client-v2/src/shared/lib/telemetry/prefixes.ts` (`gist: "gist"`)

**Interfaces:**
- Produces: `exportProject({ name, files, fetch? }): Promise<ExportResult>`, `ExportResult = {status:"created", url, files} | {status:"needs-sign-in"} | {status:"needs-gist-scope"} | {status:"failed", reason}`; `ShareGistDialog` props `{ name: string; readFiles: () => Promise<Record<string,string>>; isSignedIn: () => boolean; signIn: (opts?: { scopes?: string[] }) => Promise<void> }`.

- [ ] Step 1: tests: `signIn` posts `scopes` when given and omits it otherwise; `exportProject` maps each route answer to its result and sends the spec's events (memory provider); too-large never fetches; Base dialog renders each state (`idle`, `needs-sign-in`, `needs-scope`, `working`, `created`, `failed` per reason) with the spec's copy and the link's `rel`.
- [ ] Step 2: run them; expect failures.
- [ ] Step 3: implement. The connected dialog runs: idle → (signed out ? sign in, then export) → export → needs-scope: show "Allow gists on GitHub" → `signIn({scopes:["gist"]})` → export once more → `needs-gist-scope` again is a terminal failure.
- [ ] Step 4: tests pass; `yarn test-types`.
- [ ] Step 5: commit `feat(client-v2): share a project as a gist from a dialog`.

### Task 4: Menu entry

**Files:**
- Modify: `client-v2/src/widgets/app-nav/model/project-action.ts`, `ui/BaseProjectList.tsx`, `ui/ProjectList.tsx`, their tests, `model/telemetry.ts` doc comment.

- [ ] Step 1: tests: menu shows "Share as gist" with hint `G` for projects and lessons; `G` runs `share-gist`; `ProjectList` opens the dialog via `PgView.setModal`.
- [ ] Step 2: run; fail. Step 3: implement (icon `Share2` from lucide). Step 4: pass.
- [ ] Step 5: commit `feat(client-v2): Share as gist in the project menu`.
- [ ] Step 6: manual run on the dev server with Playwright: open menu, open dialog, signed-out state; screenshots for the PR.
