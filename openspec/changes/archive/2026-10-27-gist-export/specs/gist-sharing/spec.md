# Spec Delta

## Purpose

Lets a user put a project on their own GitHub account as a public gist, and
defines the gist format that lets the same project be opened again exactly.

## ADDED Requirements

### Requirement: Share a project from its menu

Every project and lesson row in the navigation SHALL offer **Share as gist**
in its actions menu, with the key hint `G`, and choosing it (by click or by
the key while the menu is open) SHALL open the share dialog for that project,
named `share-gist`, whose title names the project.

#### Scenario: Opening the share dialog from the menu

- **WHEN** the user opens the actions menu of a project named "counter" and
  picks Share as gist
- **THEN** a dialog titled "Share counter as a gist" opens

#### Scenario: Opening the share dialog by its key

- **WHEN** the actions menu of a project is open and the user presses `G`
- **THEN** the share dialog for that project opens

### Requirement: Say what will be published before publishing

Before anything is sent, the dialog SHALL say that the gist is public and
that anyone with the link can read the code, and that the program keypair and
the project's workspace settings stay in the browser. Nothing SHALL reach
GitHub until the user presses the dialog's create button.

#### Scenario: Nothing is sent on open

- **WHEN** the share dialog opens
- **THEN** no request to `/api/gists` has been made, and the dialog shows the
  public-gist notice and a "Create public gist" button

### Requirement: Sign in to share

A signed-out user SHALL be offered sign-in from the dialog itself; once the
sign-in succeeds the export SHALL proceed without a second press. A cancelled
or failed sign-in SHALL leave the dialog open with the reason shown.

#### Scenario: Signed out, then signed in

- **WHEN** a signed-out user presses "Sign in with GitHub to share" and
  completes sign-in
- **THEN** the gist is created and its URL is shown

#### Scenario: Sign-in cancelled

- **WHEN** the user closes the sign-in popup without finishing
- **THEN** the dialog stays open, says sign-in was cancelled, and no gist is
  created

### Requirement: Ask for gist access only when it is missing

Sign-in SHALL NOT request the `gist` scope. When the server answers that the
user's GitHub token cannot create gists, the dialog SHALL ask the user to allow
gists on GitHub with its own button (a popup needs the user's click), and after
access is granted SHALL retry the export once by itself.

#### Scenario: A session without gist access

- **WHEN** the server answers `403` with reason `needs-gist-scope`
- **THEN** the dialog shows "Allow gists on GitHub", and pressing it and
  approving on GitHub creates the gist without another press

#### Scenario: Access still missing after the popup

- **WHEN** the retry after granting access answers `needs-gist-scope` again
- **THEN** the dialog says GitHub did not grant gist access and offers no
  automatic retry

### Requirement: Show the gist when it is made

On success the dialog SHALL show the gist's URL in a read-only field, a Copy
button that copies it, and an "Open on GitHub" link that opens it in a new tab.

#### Scenario: Successful share

- **WHEN** `/api/gists` answers `201` with a gist URL
- **THEN** the dialog shows that URL, Copy puts it on the clipboard, and Open
  on GitHub links to it with `target="_blank"` and `rel="noopener noreferrer"`

### Requirement: Tell failures apart

The dialog SHALL say which of these happened, keep the user's place, and
offer to try again: the project is too large to share (over 4 MB in total or
over 300 files), GitHub is rate-limiting the user, GitHub refused the gist,
the user's GitHub authorization was revoked (offer sign-in again), or the
request did not complete.

#### Scenario: Too large is caught before sending

- **WHEN** the exportable files total more than 4 MB
- **THEN** the dialog says the project is too large to share as a gist and no
  request is made

#### Scenario: Rate limited

- **WHEN** `/api/gists` answers `429`
- **THEN** the dialog says GitHub is limiting requests and to try again later

#### Scenario: Authorization revoked

- **WHEN** `/api/gists` answers `401` with reason `github-unauthorized`
- **THEN** the dialog offers to sign in with GitHub again

### Requirement: Never publish workspace state

The export SHALL leave out every file under `.workspace/` (which holds the
program keypair, the open tabs and lesson progress) and the root
`.tutorial.json`. The same rule, declared once, SHALL decide what an import
may write.

#### Scenario: The keypair stays home

- **WHEN** a project holding `.workspace/program-info.json` is shared
- **THEN** the gist holds no file whose manifest path starts with
  `.workspace/`, and no file content equal to that file's

### Requirement: Flatten the tree into readable gist names

A gist cannot hold `/` in a file name, so each exported file SHALL go in under
its path with every `/` replaced by `__` (`src/lib.rs` becomes `src__lib.rs`).
A name already taken, or equal to the manifest's, SHALL get `-2`, `-3`, ...
before its extension. Names SHALL be assigned in path order, so the same
project always gives the same names.

#### Scenario: Nested paths

- **WHEN** a project holding `src/lib.rs` and `client/client.ts` is flattened
- **THEN** the gist holds `src__lib.rs` and `client__client.ts`

#### Scenario: A clash

- **WHEN** a project holds both `src/a.rs` and a root file `src__a.rs`
- **THEN** one is named `src__a.rs` and the other `src__a-2.rs`, the same way
  on every export

### Requirement: Carry a manifest that reverses the flattening

Every exported gist SHALL hold `.playground.json`:
`{"version": 1, "name": <project name>, "files": {<gist name>: <path>},
"empty": [<path>]}`. Empty files, which a gist cannot hold, SHALL be listed in
`empty` and not uploaded. Opening the gist SHALL give back exactly the
exported paths and contents.

#### Scenario: Round trip

- **WHEN** a project's exportable files, including an empty `tests/.keep`, are
  flattened and then read back from the resulting gist files
- **THEN** the paths and contents equal the originals, and the project name is
  the one exported

#### Scenario: An unknown manifest version

- **WHEN** a gist's manifest says `"version": 2`
- **THEN** reading it fails with reason `unsupported-version`, and nothing is
  written

### Requirement: Treat a gist's manifest as untrusted

Reading a gist SHALL fail, writing nothing, with a named reason when its
manifest is not valid JSON of the version-1 shape, maps a name to a path that
is absolute, contains `..` or an empty segment, or is one the export never
writes, or names a gist file that is not in the gist.

#### Scenario: A path that climbs out

- **WHEN** a manifest maps `x.rs` to `../../etc/x.rs`
- **THEN** reading fails with reason `unsafe-path`

#### Scenario: A manifest entry with no file

- **WHEN** a manifest maps `src__lib.rs` but the gist holds no such file
- **THEN** reading fails with reason `missing-file`

### Requirement: Place a hand-made gist's files by kind

A gist with no manifest SHALL be read file by file: Rust and Python files go
under `src/`, test files (`*.test.ts`, `*.test.js`, `*.spec.ts`, `*.spec.js`)
under `tests/`, other TypeScript and JavaScript files under `client/`, other
files of a supported language at the root, and files of a language the
Playground does not support are dropped. The result SHALL say which way the
files were placed (`manifest` or `loose`). A gist with no file left SHALL fail
with reason `no-supported-files`.

#### Scenario: A hand-made gist

- **WHEN** a gist without `.playground.json` holds `lib.rs`, `app.test.ts`,
  `client.ts` and `notes.docx`
- **THEN** reading gives `src/lib.rs`, `tests/app.test.ts` and
  `client/client.ts`, and no `notes.docx`

### Requirement: Create the gist on the server with the user's token

`POST /api/gists` SHALL require a signed-in session and a request from the
deployment's own origin, read the user's stored GitHub token on the server,
and create a public gist. It SHALL never return the token. It SHALL answer
`201 {url, id}` on success; `401 {reason: "signed-out"}` without a session;
`403` for another origin; `403 {reason: "needs-gist-scope"}` when the token
lacks the `gist` scope; `401 {reason: "github-unauthorized"}` when GitHub
rejects the token; `429` when GitHub rate-limits; `413` over the size limit;
`400` for a malformed body; `422` when GitHub rejects the gist; `502` for any
other GitHub failure; and `503` when sign-in is not configured or the session
lookup fails.

#### Scenario: Creating a gist

- **WHEN** a signed-in user whose token has the `gist` scope posts a valid
  body
- **THEN** GitHub receives `POST /gists` with `public: true` and the files,
  and the route answers `201` with the gist's `html_url` and `id`

#### Scenario: A token without the scope

- **WHEN** GitHub answers `404` or `403` and its `X-OAuth-Scopes` header does
  not list `gist`
- **THEN** the route answers `403 {reason: "needs-gist-scope"}`

#### Scenario: Signed out

- **WHEN** the request carries no session
- **THEN** the route answers `401 {reason: "signed-out"}` and calls GitHub not
  at all

### Requirement: Measure the share flow

The `gist` slice SHALL send, under the prefix `gist`:
`gist_export_started` when the user presses create (or the export resumes
after sign-in), with `files` (count of exported files); `gist_export_scope_requested`
when the dialog asks for gist access; `gist_export_succeeded` with `files`
when the gist is made; and `gist_export_failed` with `reason`, one of
`too-large`, `signed-out`, `sign-in-failed`, `needs-gist-scope`,
`github-unauthorized`, `rate-limited`, `rejected`, `request-failed`.
No event SHALL carry a file name, path, content or the gist URL.

#### Scenario: A successful share is counted

- **WHEN** a user shares a three-file project and the gist is made
- **THEN** `gist_export_started` and `gist_export_succeeded` are sent, each
  with `files: 3`

#### Scenario: A failure is counted by reason

- **WHEN** the route answers `429`
- **THEN** `gist_export_failed` is sent with `reason: "rate-limited"`
