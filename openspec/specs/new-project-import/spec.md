# new-project-import Specification

## Purpose

Importing a GitHub repository or gist from New project's Import from
GitHub card: where the link goes, what the card shows while it runs and
when it fails, how it shares the page with Start and the cards, and the
events it sends.

## Requirements

### Requirement: New project imports a GitHub or gist link

New project SHALL show, under Start from scratch, a card whose text field is
labelled "Import from GitHub" (a `<label>` tied to the field) with the
placeholder "Paste a GitHub repo or gist link", and an outline button named
"Import". Import SHALL be disabled while the field is empty or holds only
spaces. Import, or Enter in the field, SHALL import the trimmed link: a link
`parseGistUrl` reads SHALL go to `importGist(link, "new-project")`, and any
other link `PgGithub.isValidUrl` accepts to `PgGithub.import(link)`. Once the
import resolves, New project SHALL close and the imported project SHALL be
the one open. A link whose project already exists SHALL open that project, as
the import does elsewhere.

#### Scenario: A TypeScript-only repository

- **WHEN** a user types `https://github.com/alice/ts-client` into "Import
  from GitHub" on New project, the repository holding only `index.ts` and
  `tests/rpc.test.ts`, and presses Import
- **THEN** New project closes and the explorer shows
  `/github-alice/ts-client/client/index.ts` and
  `/github-alice/ts-client/tests/rpc.test.ts`

#### Scenario: A gist link (manual)

- **WHEN** a user imports a `gist.github.com/<owner>/<id>` link from the card
- **THEN** `importGist` is called with that link and `"new-project"`, and New
  project closes once it resolves

#### Scenario: Empty field (manual)

- **WHEN** the field is empty or holds only spaces
- **THEN** Import is disabled and Enter does nothing

### Requirement: The card shows the import while it runs

While an import runs, the field SHALL be disabled and the button SHALL be
disabled, carry `aria-busy="true"`, and read "Importing…" beside a spinner.

#### Scenario: Importing (manual)

- **WHEN** a user presses Import and GitHub has not answered yet
- **THEN** the field is disabled and the button reads "Importing…" with
  `aria-busy="true"`

### Requirement: The card says why an import failed

A failure SHALL show its message under the field (`FieldError`), with the
field `aria-invalid="true"` and described by the message; editing the field
SHALL clear it. The message SHALL be:

- "This isn't a GitHub repo or gist link." for a link that is neither, found
  in the browser before any request;
- "Playground can't find <owner>/<repo> on GitHub. It may be private,
  renamed or deleted." when GitHub answers 404 for the repository
  (`GithubImportError` with reason `not-found`);
- "Could not reach GitHub. Check the connection and try again." when a
  request never got an answer, for a repository and a gist alike;
- the import's own message for every other failure (a gist not found, a
  file of the listed tree that GitHub cannot find (`GithubFileError`), the
  rate limit, a repository too large, no Solana program and no TypeScript).

Closing the program picker of a repository with several programs
(`ImportCancelledError`) SHALL return the card to idle with no message.

#### Scenario: Not a GitHub link

- **WHEN** a user imports `https://gitlab.com/acme/escrow`
- **THEN** "This isn't a GitHub repo or gist link." shows under the field,
  and no request reaches `api.github.com`

#### Scenario: Private or missing repository

- **WHEN** a user imports `https://github.com/acme/escrow-private` and GitHub
  answers 404 for its tree
- **THEN** "Playground can't find acme/escrow-private on GitHub. It may be
  private, renamed or deleted." shows under the field, and New project stays

#### Scenario: Picker closed (manual)

- **WHEN** a user imports a repository with several programs and closes the
  program picker
- **THEN** the card is idle, with no message, and New project stays

### Requirement: New project runs one action at a time

While the import runs, Start from scratch and the tutorial and program
cards SHALL wait; while Start or a card's Open runs, Import SHALL be
disabled.

#### Scenario: A card opens during an import (manual)

- **WHEN** an import runs and a user presses Open on a program card
- **THEN** nothing opens and the import goes on

#### Scenario: Import while Start runs (manual)

- **WHEN** Start from scratch is making a project
- **THEN** Import is disabled

### Requirement: The card's import is measured

The `features/new-project` tracker SHALL declare and send:

- `new_project_imported {via}` once the import resolves, `via` being
  `"github"` or `"gist"`;
- `new_project_import_failed {via, reason}` when it fails, `via` being
  `"github"`, `"gist"` or `"unknown"` (a link that is neither), and `reason`
  one of `"bad-link"`, `"not-found"`, `"rate-limited"`, `"too-large"`,
  `"no-program"`, `"invalid"`, `"network"` (GitHub unreachable, refusing, or
  answering with a server error) or `"unexpected"` (anything else).

Only an `unexpected` failure SHALL be logged as an error with `report: true`;
every other failure SHALL be logged as a warning. A request that never got an
answer SHALL show "Could not reach GitHub. Check the connection and try
again." A throw from the import itself SHALL end as an `unexpected` failure
showing "Could not import it.", and SHALL release New project's other
actions.

A closed program picker SHALL send neither. A gist import SHALL also send
`gist_import_*` with `via: "new-project"`, a value `GistImportSource` gains.

#### Scenario: A repository imports (manual)

- **WHEN** a user imports a repository from the card
- **THEN** the memory provider records `new_project_imported` once with
  `via: "github"`

#### Scenario: A bad link (manual)

- **WHEN** a user imports `https://gitlab.com/acme/escrow`
- **THEN** the memory provider records `new_project_import_failed` with
  `via: "unknown"` and `reason: "bad-link"`
