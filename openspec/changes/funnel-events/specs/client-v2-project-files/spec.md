# Spec Delta

## Purpose

What the product reports when a user imports a project, opens one from a
GitHub link without importing it, or exports one, so the funnel can count
projects that arrive and leave without reading a URL, a file, or a name.

Every scenario is marked `(manual)`: events leave the browser only through
GA4, which no Playwright test reads. A unit test through the memory provider
holds each one, and each can be checked in GA4's DebugView.

## ADDED Requirements

### Requirement: The slice declares the project events

The `features/project-files` slice SHALL declare, describe, and export through
its `index.ts` the events of this spec in `model/telemetry.ts` with prefix
`project`, registered in `shared/lib/telemetry/prefixes.ts`. Legacy code
SHALL send them through that tracker without a scope. It SHALL export one
function that maps an import error to the `reason` this spec allows, used
by every import call site.

#### Scenario: The tracker is the only sender (manual)

- **WHEN** an import dialog sends `project_imported`
- **THEN** the event goes through `features/project-files`' tracker, and
  the memory provider records it with no scope

### Requirement: A GitHub import is counted

`ImportGithub` (its dialog's submit) and its `Example` (the Import button)
in `views/sidebar/explorer/Component/Modals/ImportGithub.tsx` SHALL send
`project_imported {via: "github"}` once `PgGithub.import` resolves, and
`project_import_failed {via: "github", reason}` when it rejects, except
with `ImportCancelledError`, which sends nothing. Importing a repository
that is already a project opens it and counts as imported.

#### Scenario: A GitHub import finishes (manual)

- **WHEN** a user imports a repository from the GitHub import dialog
- **THEN** `project_imported` is sent once with `via: "github"`

#### Scenario: A repository that does not exist (manual)

- **WHEN** a user imports a GitHub URL whose repository answers 404
- **THEN** `project_import_failed` is sent with `via: "github"` and
  `reason: "not-found"`

#### Scenario: The program choice is closed (manual)

- **WHEN** a user closes the program choice of a repository with several
  programs
- **THEN** neither `project_imported` nor `project_import_failed` is sent

### Requirement: A file import is counted

`ImportFs` in `views/sidebar/explorer/Component/Modals/ImportFs.tsx` SHALL
send `project_import_failed {via: "files", reason}` when `onDrop` cannot
read or convert the dropped files, `project_imported {via: "files"}` once
its submit has created the project, and `project_import_failed` when the
submit fails.

#### Scenario: Dropped files that match no framework (manual)

- **WHEN** a user drops a folder whose layout matches no framework
- **THEN** `project_import_failed` is sent with `via: "files"` and
  `reason: "unsupported"`

#### Scenario: A file import finishes (manual)

- **WHEN** a user drops a project folder, names it, and presses Import
- **THEN** `project_imported` is sent once with `via: "files"`

### Requirement: A temporary project's import is counted

`ImportTemporary` in
`views/sidebar/explorer/Component/Modals/ImportTemporary.tsx` SHALL send
`project_imported {via: "temporary"}` once `PgExplorer.createWorkspace`
resolves, and `project_import_failed {via: "temporary", reason}` when it
rejects.

#### Scenario: A temporary project is imported (manual)

- **WHEN** a user opens a GitHub link, presses Import on the temporary
  project, and names it
- **THEN** `project_imported` is sent once with `via: "temporary"`

### Requirement: Import failures carry an enumerated reason

`reason` SHALL be `not-found` (GitHub answered 404), `rate-limited`
(GitHub's hourly limit is spent), `too-large` (GitHub returned part of the
file list), `no-source` (nothing in a supported language), `unsupported`
(the layout matches no framework, or converts to nothing), `network` (the
request got no answer), or `other`. The reason SHALL come from a typed
error, never from an error message.

#### Scenario: GitHub's limit is spent (manual)

- **WHEN** a GitHub request fails with 403 and `x-ratelimit-remaining: 0`
- **THEN** the reason is `rate-limited`

#### Scenario: A failure of no known kind (manual)

- **WHEN** an import fails with an error the mapping does not know
- **THEN** the reason is `other`

### Requirement: A project opened from a GitHub link is counted

The `github` route (`/github/<owner>/<repo>…`) in `routes/github/github.tsx`
SHALL send `project_viewed`, with no parameters, once `PgGithub.getFiles`
has returned the repository's files, and `project_view_failed {reason}` when
it throws, with the reasons of `project_import_failed`.

#### Scenario: A GitHub link opens (manual)

- **WHEN** a user opens the Playground at `/github/coral-xyz/xnft`
- **THEN** `project_viewed` is sent once

#### Scenario: A GitHub link that does not exist (manual)

- **WHEN** a user opens a GitHub link whose repository answers 404
- **THEN** `project_view_failed` is sent with `reason: "not-found"`

### Requirement: An export is counted with where it started

`convertAndExport` and `exportWithoutChanges` in `ExportWorkspace`
(`views/sidebar/explorer/Component/Modals/ExportWorkspace.tsx`) SHALL send
`project_exported {via: "dialog", converted}` once the zip is handed to the
browser, and `project_export_failed {via: "dialog"}` when nothing was
saved. `converted` is `true` only when the conversion succeeded; a fallback
to the project as it is sends `false`.

#### Scenario: Convert and export (manual)

- **WHEN** a user picks "Convert and export" and the conversion succeeds
- **THEN** `project_exported` is sent with `via: "dialog"` and
  `converted: true`

#### Scenario: The conversion falls back (manual)

- **WHEN** a user picks "Convert and export", the conversion fails, and the
  plain export succeeds
- **THEN** `project_exported` is sent once with `converted: false`

### Requirement: The settings page's export is counted

The Export button (named "Export project") of the `Project` section's
Export project row in `widgets/settings-page/ui/SettingsPage.tsx` SHALL send
`project_exported {via: "settings", converted: false}` once
`PgFramework.exportWorkspace` resolves, and
`project_export_failed {via: "settings"}` when it rejects.

#### Scenario: Export from the settings page fails (manual)

- **WHEN** a user presses Export in Settings and the zip cannot be made
- **THEN** `project_export_failed` is sent with `via: "settings"`

### Requirement: No project event names the project

No event of the slice SHALL carry a URL, a repository or project name, a
file name, file content, or an error message.

#### Scenario: A failed GitHub import (manual)

- **WHEN** a GitHub import fails with a message that names the repository
- **THEN** no parameter of `project_import_failed` contains the
  repository's name
