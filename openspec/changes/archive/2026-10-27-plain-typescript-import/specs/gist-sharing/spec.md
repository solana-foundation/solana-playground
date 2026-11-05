# Spec Delta

## MODIFIED Requirements

### Requirement: A gist that cannot be opened says why

The import SHALL show one message per cause: a gist that is missing or
was deleted, GitHub's hourly request limit, a gist with more files than
GitHub lists, a manifest the format refuses, a gist with neither a
program nor a TypeScript or JavaScript file, an
answer that is not a gist, and any other failed request with its status. A file GitHub's gist API cuts short SHALL be
downloaded whole rather than imported cut.

#### Scenario: A missing gist
- **WHEN** the gist id does not exist, in the dialog or behind a link
- **THEN** the import fails with a message that the gist was not found and the link may be out of date, shown in the dialog or in place of the view

#### Scenario: GitHub's hourly limit is reached
- **WHEN** GitHub answers 403 with no requests remaining
- **THEN** the import fails with a message to try again later

#### Scenario: A large file in a gist
- **WHEN** the gist API marks a file as truncated
- **THEN** the file's whole content is downloaded and imported

## ADDED Requirements

### Requirement: A gist with no program opens as a TypeScript project

A gist in which no supported framework finds a program but whose files,
once placed, include a TypeScript or JavaScript file under `client/` or
`tests/` SHALL open as a project with no program, in the dialog and
behind a link alike. A gist with neither SHALL be refused with reason
`no-program` and the message "This gist holds no Solana program and no
TypeScript or JavaScript to open."

#### Scenario: A hand-made gist of TypeScript
- **WHEN** the user imports a gist without `.playground.json` that holds
  `client.ts` and `client.test.ts`
- **THEN** a project is created holding `client/client.ts` and
  `tests/client.test.ts`, and `gist_import_succeeded` is sent with
  `layout: loose`

#### Scenario: A hand-made gist of TypeScript behind a link
- **WHEN** the user opens `/gist/<id>` for a gist that holds only `client.ts`
- **THEN** the view shows `client.ts` and the stepper offers only Write

#### Scenario: A gist with nothing to open
- **WHEN** the user imports a gist that holds only `notes.md`
- **THEN** the import fails, and `gist_import_failed` is sent with
  `reason: no-program`
