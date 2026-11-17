# Import from GitHub on New project: implementation plan

> **As built (differs from this plan).** The branch merged master's typed import
> errors, so `GithubNotFoundError` was never added: a repository's 404 is
> `GithubImportError` with reason `not-found`, one file's is `GithubFileError`,
> and failures map through `GITHUB_REASONS`, never read from the message. Event
> parameters are `via`, not `source`/`from`. `NewProjectState` exposes
> `isImportHeld` (not `importHeld`), and `BaseImportFromUrl` uses `isImporting`
> / `canImport` (not `importing` / `usable`). The
> gist import gained `GistUnreachableError` and the reason `unexpected`. The
> synced specs `new-project-import` and `gist-sharing` hold the final text.

> **For agentic workers:** executed inline (superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the "Import from GitHub" card on New project (from #466) imports a GitHub repository or gist and lands the user in it.

**Architecture:** `widgets/catalog/model/link-import.ts` routes the link to `importGist` or `PgGithub.import` and maps any failure to a message and a telemetry `reason` (a feature never imports another, so this lives in the widget); `ImportFromUrl` (connected) drives `BaseImportFromUrl` (view, unchanged from #466); `useNewProject` keeps one action at a time and closes the page.

**Tech Stack:** React, vitest + Testing Library, Playwright, `createTracker` telemetry.

**Spec:** `openspec/changes/new-project-import-url/specs/new-project-import/spec.md`, `design.md` beside it.

## Global Constraints

- Copy, verbatim: `This isn't a GitHub repo or gist link.` · `Playground can't find <owner>/<repo> on GitHub. It may be private, renamed or deleted.` · label `Import from GitHub` · placeholder `Paste a GitHub repo or gist link` · button `Import` / `Importing…`.
- `features/` never imports `widgets/`; the toast after the page closed stays in `widgets/catalog`.
- Events: `new_project_imported {source: "github"|"gist"}`, `new_project_import_failed {source: "github"|"gist"|"unknown", reason: "bad-link"|"not-found"|"rate-limited"|"too-large"|"no-program"|"invalid"|"network"|"unexpected"}`.
- `GithubNotFoundError` keeps today's 404 message, so the explorer's dialog reads the same.

## Review Focus

- Link with spaces around it: trimmed before routing (test in Task 2).
- A gist link must win over the repository check (`gist.github.com/alice/abc` is not a repo; test in Task 2).
- Link without a scheme (`github.com/alice/repo`): accepted, as `isValidUrl` does (test in Task 2).
- Typing during "Importing…" is impossible (field disabled; test in Task 3), and editing after a failure clears it (test in Task 3).
- The page left mid-import: a failure toasts, a success does not close a later visit (`closeIfOpen`; test in Task 4).

---

### Task 1: typed 404 in `PgGithub` (tasks.md 1.1)

**Files:** Modify `client-v2/src/utils/github.ts` (`_getTree`); Test `client-v2/src/utils/github.test.ts`.

**Interfaces — Produces:** `export class GithubNotFoundError extends Error { readonly owner: string; readonly repo: string }`, exported from `utils/github.ts` and `@/utils`.

- [ ] Test `"a repository GitHub answers 404 for rejects with GithubNotFoundError"`: stub `fetch` to 404 for the tree; `await expect(PgGithub.getFiles("https://github.com/acme/gone")).rejects` is `instanceof GithubNotFoundError`, `owner === "acme"`, `repo === "gone"`, message contains `may be private`.
- [ ] Run `yarn vitest run src/utils/github.test.ts` → FAIL.
- [ ] Throw it from `_getTree` on `response.status === 404`, message from `_getErrorMessage`.
- [ ] Run → PASS. Commit `feat(client-v2): PgGithub tells a missing repository apart (HOO-2608)`.

### Task 2: the link model (tasks.md 1.2)

**Files:** Create `client-v2/src/widgets/catalog/model/link-import.ts` + `link-import.test.ts`; Create `features/new-project/model/link-import.ts` (types only); Modify `features/new-project/model/telemetry.ts`, `features/gist/model/telemetry.ts` (`GistImportSource` + `"new-project"`).

**Interfaces — Produces (feature, exported from its index):**
- `type LinkSource = "github" | "gist"`
- `type LinkImportFailure = "bad-link" | "not-found" | "rate-limited" | "too-large" | "no-program" | "invalid" | "network" | "unexpected"`
- `type LinkImport = { outcome: "imported"; source: LinkSource } | { outcome: "cancelled" } | { outcome: "failed"; source: LinkSource | "unknown"; reason: LinkImportFailure; message: string; error?: unknown }`

**Produces (widget):** `importLink(link: string): Promise<LinkImport>` — trims; gist first (`parseGistUrl`), then `PgGithub.isValidUrl`; never throws.

- [ ] Tests (`importGist`, `PgGithub.import` mocked): `" https://github.com/a/b "` → `PgGithub.import("https://github.com/a/b")`, `{outcome:"imported",source:"github"}`; `"github.com/a/b"` → github; `"https://gist.github.com/alice/0123abcd"` → `importGist(link,"new-project")`, source gist; `"https://gitlab.com/acme/escrow"` → failed, unknown, bad-link, bad-link copy, neither import called. Rejections: `ImportCancelledError` → cancelled; `GithubNotFoundError("acme","x")` → can't-find copy + not-found; `GistImportError("rate-limited", m)` → `m` + rate-limited; `Error("GitHub's hourly request limit…")` → rate-limited; `"…too large to import…"` → too-large; `"No program code found in a/b."` and the not-a-program copy → no-program; other `Error(m)` → `m` + request-failed; non-Error → `"Could not import it."` + request-failed.
- [ ] Run → FAIL. Implement. Run → PASS.
- [ ] Declare the two events in `NewProjectEvents` with doc comments. Commit.

### Task 3: the card (tasks.md 2.1)

**Files:** Modify `features/new-project/ui/ImportFromUrl.tsx` (presets and fake gone); Create `features/new-project/ui/ImportFromUrl.test.tsx`.

**Interfaces — Produces:** `ImportFromUrlProps { importLink: (link: string) => Promise<LinkImport>; held?: boolean; onRunning?: (running: boolean) => void; onImported?: () => void; onFailed?: (message: string) => void }`, exported from the slice's `index.ts` with the type.

- [ ] Tests (`importLink` a stub prop, memory telemetry provider): success → `onRunning(true)` then `(false)`, `onImported` once, `new_project_imported {source:"github"}`; while pending the field is disabled and the button `aria-busy`, reads `Importing…`; bad link → message shown, field `aria-invalid`, `new_project_import_failed {source:"unknown",reason:"bad-link"}`, `onFailed(message)`; cancel → idle, no message, no event, `onImported` not called; typing after a failure clears the message; `held` disables Import.
- [ ] Run → FAIL. Implement like `StartFromScratch` (log `warn` for user-caused failures, `error` with `report: true` for `unexpected`). Run → PASS. Commit.

### Task 4: New project holds the import (tasks.md 2.2)

**Files:** Modify `widgets/catalog/model/use-new-project.ts`, `widgets/catalog/ui/NewProject.tsx`, `widgets/catalog/ui/open-failed-toast.tsx` (`toastImportFailed`, lead `Could not import.`, name `new-project-import-failed`), `widgets/catalog/ui/NewProject.test.tsx`.

**Interfaces — Consumes:** `ImportFromUrlProps`. **Produces:** `NewProjectState` gains `importHeld: boolean`, `onImporting(running)`, `onImportFailed(message)`; `busy` (cards) unchanged; Start's `held` becomes `busy || importing`; cards' `held` includes `importing`.

- [ ] Tests in `NewProject.test.tsx` (its mocked `ImportFromUrl` records props): while `onImporting(true)`, a card's Open does nothing and Start gets `held`; while a card opens, `ImportFromUrl` gets `held`; `onImported` closes the page.
- [ ] Run → FAIL. Implement. Run → PASS. Commit.

### Task 5: e2e (tasks.md 2.3)

**Files:** Create `client-v2/e2e/new-project-import.e2e.spec.ts`.

- [ ] Reuse `stubRepository` shape from `project-without-program.e2e.spec.ts` (owner `alice`, repo `ts-client`, files `index.ts`, `tests/rpc.test.ts`). Open New project as `new-project.e2e.spec.ts` does; fill `getByLabel("Import from GitHub")`; press Import; expect `[data-path="/github-alice/ts-client/client/index.ts"]` and New project gone.
- [ ] Bad link: `https://gitlab.com/acme/escrow` → the bad-link copy visible; a `page.on("request")` recorder saw no `api.github.com`.
- [ ] 404: route the tree to 404 → can't-find copy visible.
- [ ] Run `yarn test-e2e:with-stubs new-project-import` (or `yarn test-e2e` with `USE_WASM_STUBS=true`) → PASS. Commit.

Then tick tasks.md lines, `yarn run check`, phase 5 and 6 of the method.
