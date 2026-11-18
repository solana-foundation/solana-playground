## Why

The customer's main ask at the last demo was bringing an existing project
in, a TypeScript one above all. The import exists (`PgGithub.import`,
`importGist`, and the TypeScript layout from HOO-2147), but New project offers
no way to reach it: the only link import is the explorer's dialog behind
Settings. Almaz's "Import from GitHub" card (#466) puts a link field on New
project; it is a design stand-in that imports nothing. HOO-2608 wires it.

## What Changes

- The "Import from GitHub" card on New project imports for real: a GitHub repo
  or folder link goes to `PgGithub.import`, a gist link to `importGist`, and
  the user lands in the project while New project closes.
- A link that is neither is refused in the browser with "This isn't a GitHub
  repo or gist link." under the field; no request is sent.
- A repository GitHub answers 404 for shows "Playground can't find
  <owner>/<repo> on GitHub. It may be private, renamed or deleted." in the same
  spot (designers' spec 10: a private and a deleted repo answer alike).
- Every other failure shows the import's own message there; closing the
  program picker is not a failure and returns the card to idle.
- New project runs one action at a time across Start, the import and the
  cards.
- The card tells "can't find" from the other failures by the typed errors
  master's `PgGithub` throws: `GithubImportError` with reason `not-found` for
  the repository's 404, and `GithubFileError` for one file's, which keeps its
  own message.
- The `?import=` design presets and the faked answer of #466 go.
- Telemetry, `features/new-project`: adds `new_project_imported {via}` and
  `new_project_import_failed {via, reason}`. `features/gist`: its
  `GistImportSource` gains `"new-project"`, so `gist_import_*` from the card
  are told apart from the dialog's. No event is renamed or removed.
- Funnel: step "Get a project: new" keeps `new_project_started` firing
  untouched. Step "Get a project: import" is still pending in `funnel-events`
  (`project_imported` does not exist yet); the card is a new call site for it,
  recorded for that change through Intake rather than sending an event it has
  not declared.

## Capabilities

### New Capabilities

- `new-project-import`: importing a GitHub repository or gist from New
  project's link card, its states, and its events.

### Modified Capabilities

- `gist-sharing`: the gist import's `via` gains `new-project`, and
  `gist_import_failed` gains reason `unexpected` for the import's own faults.

## Impact

- Code: `client-v2/src/features/new-project/` (the card, its outcome type
  and events), `client-v2/src/widgets/catalog/` (routing the link, since a
  feature never imports another, and New project's state holding the
  import), `client-v2/src/utils/github.ts` (a file's 404 as `GithubFileError`),
  `client-v2/src/features/gist/` (one `via` value, the `unexpected` reason,
  `GistUnreachableError` for a request GitHub never answered).
- Tests: unit tests for the link model and the card, an e2e spec that imports
  a TypeScript-only repository through the card and shows the bad-link and
  can't-find states.
- Out of scope: the explorer's Import from GitHub dialog, upload of a zip or
  folder, an import card on Home, the rate-limit reset time and "open your
  copy / fresh copy" on a second import (designers' spec 10; the existing
  import opens the existing project).
