## Context

#466 (Almaz) added `BaseImportFromUrl`, the card's view, and `ImportFromUrl`,
a stand-in that fakes its answer and reads its state from `?import=`. The
real imports exist: `PgGithub.import(url, onProgress)` for a repository or a
folder of one (the TypeScript-only layout from HOO-2147 included) and
`importGist(url, from)` for a gist. The explorer's dialog (`ImportGithub.tsx`)
already routes between them with `isGistUrl`.

New project's state lives in `useNewProject` (`widgets/catalog`), which keeps
one action at a time across Start (`starting`) and the cards (`busy`) and
closes the page through `closeIfOpen`.

## Goals / Non-Goals

**Goals:** the card imports and lands the user in the project; the designed
states for a bad link and a private repository; one action at a time; events.

**Non-Goals:** changing the explorer's dialog, upload, Home, the
rate-limit reset time, "open your copy / fresh copy".

## Decisions

1. **Route like the explorer's dialog, in the widget.** `parseGistUrl` first
   (a gist link also contains `github.com`), then `PgGithub.isValidUrl`;
   neither is a bad link, refused before any request. A feature never imports
   another feature, so the routing and the failure mapping live in
   `widgets/catalog/model/link-import.ts`, which imports `features/gist` and
   `@/utils`. The card (`features/new-project`, a `Base`/connected pair) takes
   it as one prop, `importLink(link): Promise<LinkImport>`, an outcome
   (`imported` with its source, `cancelled`, or `failed` with source, reason
   and message) rather than a throw, and owns the states, the logging and the
   events.
2. **A typed 404 for repositories.** Master's `PgGithub` throws
   `GithubImportError` with a `reason`; a 404 is `not-found`. The card maps a
   `not-found` to the designers' can't-find copy, taking `owner` and `repo`
   from `PgGithub.parseUrl(link)`. A 404 on one file (`_getFile`) throws
   `GithubFileError`, a subclass with the same reason: the repository exists,
   so the card keeps that error's own message. A string match on the message
   was the alternative; it breaks the moment the copy changes.
3. **Copy for the private state.** Almaz's card says "This repo is private.
   Make it public or import it from your machine." GitHub answers 404 for a
   private repository and for a missing one alike, so the card cannot know
   which; designers' spec 10 settles it with one message for both. The card
   uses spec 10's: "Playground can't find <owner>/<repo> on GitHub. It may be
   private, renamed or deleted." (design gap, decided here and sent to the
   designers' batch). "Import it from your machine" names an upload New
   project does not have.
4. **One action at a time.** `useNewProject` gains `importing`; Start waits
   on `busy || importing`, the cards on `busy || starting || importing`, and
   Import on `busy || starting`. `NewProjectState` exposes it as
   `onImporting` and `isImportHeld`, matching Start's `onStarting`/`held`.
   `importLink` also queues its imports app-wide (one at a time across New
   project's mounts), so a page reopened mid-import cannot run a second one.
5. **Failure after the page closes.** As Start does: once New project was
   left mid-import, a failure comes up as a toast (`toastImportFailed`, lead "Could not import."), since
   no field is left to show it.
6. **Events.** `new_project_imported` / `new_project_import_failed` in
   `features/new-project`'s tracker, each with `via` (master's telemetry rule
   names a trigger parameter `via`). The `reason` comes from
   `GistImportError.reason` for a gist (`request-failed` → `network`; the
   import's own faults arrive as `unexpected`), from
   `GithubImportError.reason` for a repository through `GITHUB_REASONS`
   (`no-source` → `no-program`, `other` → `network`), and from
   `ConversionError` (`no-program`). A request that never got an answer
   (`GithubImportError` reason `network`, `GistUnreachableError`) shows
   "Could not reach GitHub…" for both. GitHub's failures are the user's to
   retry, logged as warnings. Only `unexpected`, anything else, is reported. The funnel's `project_imported`
   stays with `funnel-events`, which owns it.

## Risks / Trade-offs

- A plain `Error` from the import still shows its raw message; it is counted
  as `unexpected` and reported.
- The e2e stubs GitHub with `page.route`, as `project-without-program` does;
  it proves the wiring, not GitHub's live answers.
