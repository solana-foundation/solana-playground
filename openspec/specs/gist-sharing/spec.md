# gist-sharing Specification

## Purpose
Lets a user put a project on their own GitHub account as a gist, secret by default, and
defines the gist format that lets the same project be opened again exactly.

## Requirements

### Requirement: Share a project from its menu

The row of the project that is open SHALL offer **Share** in its actions
menu, with the key hint `G`. Choosing it, by click or by the key while the
menu is open, SHALL open the share dialog for that project. The dialog is
named `share-gist` and titled "Share <project name> as a gist". The row of
any other project or lesson SHALL NOT offer Share, and `G` SHALL do nothing
in its menu.

#### Scenario: Opening the share dialog from the menu
- **WHEN** "counter" is the open project and the user opens its row's actions
  menu and picks Share
- **THEN** a dialog titled "Share counter as a gist" opens

#### Scenario: Opening the share dialog by its key
- **WHEN** the open project's actions menu is open and the user presses `G`
- **THEN** the share dialog for that project opens

#### Scenario: Another project's row
- **WHEN** the user opens the actions menu of a project that is not open
- **THEN** the menu has no Share item, and pressing `G` opens no dialog

### Requirement: Say what will be published before publishing

Before anything is sent, the dialog SHALL offer a choice of who can open the
gist, a radio group labelled "Who can open it" with two cards: Secret
(`share-gist-visibility-secret`, "Only people you send the link to. Not
listed on your GitHub profile.") and Public (`share-gist-visibility-public`,
"Listed on your GitHub profile, anyone can find it."). Secret SHALL be
selected each time the dialog opens. Under the choice the dialog SHALL say
how many files go to the gist and their size, list them on request together
with the title and the manifest, and say that the program keypair and workspace settings
stay in the browser. To list the files the dialog reads the project in the
browser; nothing SHALL reach GitHub until the user presses the footer's
action. That action SHALL read "Create secret gist" or "Create public gist",
after the choice, and "Creating gist…" while the request runs, with the
choice locked.

#### Scenario: Nothing is sent on open
- **WHEN** the share dialog opens
- **THEN** no request to `/api/gists` has been made, Secret is selected, and
  the dialog shows a "Create secret gist" button

#### Scenario: Sharing a public gist
- **WHEN** the user picks Public and presses "Create public gist"
- **THEN** the request to `/api/gists` carries `public: true`

#### Scenario: Sharing with the default
- **WHEN** the user presses "Create secret gist" without touching the choice
- **THEN** the request to `/api/gists` carries `public: false`

### Requirement: Sign in to share

A signed-out user who opens the share dialog SHALL first see a sign-in prompt
in its place, titled "Sign in to share", saying "Your project goes to a gist on
your GitHub account.", with a "Sign in with GitHub" button that shows the
GitHub mark and a Cancel button (on a phone, the page's Close). Once the
sign-in succeeds the same dialog SHALL become the share dialog for the same
project, and nothing SHALL reach GitHub until the user presses "Create secret
gist" or "Create public gist". A signed-in user SHALL go straight to the
share dialog. A session that ends while the share dialog is open SHALL still
be mended from inside the dialog, which offers to sign in again and then
shares with the visibility the user chose, without a second press.

While a sign-in or the gist-access popup waits for GitHub, the primary
button of the prompt or the dialog SHALL read "Cancel sign-in" (the frame's
submit in both), as the prototype's own sign-in control does.
Pressing it SHALL stop the wait and keep the dialog open on the step it came
from (the prompt, signing in again, or allowing gists), saying "Sign-in
cancelled.", with the button back to its own label, which starts a new
sign-in. While it waits the frame SHALL draw no Cancel beside it, so the
footer holds one cancel; the header's Close SHALL stay available: it closes
the dialog and cancels the sign-in. A sign-in that ends without a session SHALL keep
the dialog open with the reason shown.

#### Scenario: Signed out, the prompt comes first
- **WHEN** a signed-out user picks Share on the open project "counter"
- **THEN** a dialog titled "Sign in to share" opens with the line "Your
  project goes to a gist on your GitHub account.", a "Sign in with GitHub"
  button carrying the GitHub mark, and Cancel, and no request to
  `/api/gists` has been made

#### Scenario: Signed out, then signed in
- **WHEN** the user presses "Sign in with GitHub" in the prompt and completes
  sign-in
- **THEN** the dialog becomes "Share counter as a gist" with Secret selected
  and a "Create secret gist" button, and no request to `/api/gists` has been
  made

#### Scenario: Signed in, no prompt
- **WHEN** a signed-in user picks Share on "counter"
- **THEN** the dialog opens titled "Share counter as a gist", without the
  prompt

#### Scenario: Sign-in cancelled
- **WHEN** the user presses "Sign in with GitHub" and, while the popup waits
  and the button reads "Cancel sign-in", presses it
- **THEN** the sign-in stops, the dialog stays open on the prompt saying
  "Sign-in cancelled.", no gist is created, and pressing "Sign in with
  GitHub" starts a new sign-in

#### Scenario: Closing the dialog while sign-in waits
- **WHEN** the user presses "Sign in with GitHub" and, while it waits,
  presses the header's Close
- **THEN** the sign-in stops, the dialog closes, and no gist is created

#### Scenario: A sign-in that cannot start
- **WHEN** the user presses "Sign in with GitHub" and sign-in cannot start
- **THEN** the prompt stays open and says "Could not start sign-in", and no
  gist is created

#### Scenario: Cancel leaves without signing in
- **WHEN** the user presses Cancel in the prompt
- **THEN** the dialog closes and no sign-in starts

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

On success the dialog SHALL be titled "Shared as a secret gist" or "Shared as
a public gist" and say "<project name> opens in Playground from this link",
with a line on who can open it. It SHALL show the Playground link
`<origin>/gist/<id>`, where `<id>` is the gist's id, in a read-only field
labelled "Playground link". The footer's action SHALL read "Copy link", and
"Copied" once a copy succeeds. Under the field SHALL come an "Open the gist
on GitHub" link that opens the gist in a new tab. The gist's own URL SHALL
NOT be shown as the link to send.

#### Scenario: Successful share
- **WHEN** `/api/gists` answers `201` with the URL `https://gist.github.com/a/b`
  and id `b`
- **THEN** the dialog is titled "Shared as a secret gist", shows
  `<origin>/gist/b` in the Playground link field, and Open the gist on GitHub
  links to `https://gist.github.com/a/b` with `target="_blank"` and
  `rel="noopener noreferrer"`

### Requirement: Tell failures apart

The dialog SHALL say which of these happened and keep the user's place: the
project is too large to share (over 4 MB in total or over 300 files), GitHub
is rate-limiting the user, GitHub refused the gist, the user's GitHub
authorization was revoked, or the request did not complete. A rate limit and
a failed request SHALL offer "Try again". A revoked authorization SHALL offer
"Sign in with GitHub". A project that is too large and a gist GitHub refused
fail the same on every retry, so they SHALL offer Close only.

#### Scenario: Too large is caught before sending

- **WHEN** the exportable files total more than 4 MB
- **THEN** the dialog says the project is too large to share as a gist,
  offers Close only, and no request is made

#### Scenario: Rate limited

- **WHEN** `/api/gists` answers `429`
- **THEN** the dialog says "GitHub is limiting requests from this browser. Try
  again in a few minutes."

#### Scenario: GitHub refused the gist

- **WHEN** `/api/gists` answers `422` with reason `rejected`
- **THEN** the dialog says "GitHub refused the gist. Nothing was published."
  and offers no retry: Close is the only way out

#### Scenario: Request failed

- **WHEN** `/api/gists` answers `502` with reason `request-failed`, or the
  request does not complete, or GitHub answers `201` with a body that does
  not parse
- **THEN** the dialog says "Could not export to GitHub. Check your gists on
  GitHub before you try again." with a "Your gists" link, and offers to try
  again, since the gist may exist

#### Scenario: Authorization revoked

- **WHEN** `/api/gists` answers `401` with reason `github-unauthorized`
- **THEN** the dialog offers "Sign in with GitHub"

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
A name already taken, or equal to the manifest's or the title's, SHALL get `-2`, `-3`, ...
before its extension. Names SHALL be assigned in path order, so the same
project always gives the same names.

#### Scenario: Nested paths (manual)

- **WHEN** a project holding `src/lib.rs` and `client/client.ts` is flattened
- **THEN** the gist holds `src__lib.rs` and `client__client.ts`
- Pinned by client-v2/src/features/gist/lib/format.ts: "nested paths become __
  names"

#### Scenario: A clash (manual)

- **WHEN** a project holds both `src/a.rs` and a root file `src__a.rs`
- **THEN** one is named `src__a.rs` and the other `src__a-2.rs`, the same way
  on every export
- Pinned by client-v2/src/features/gist/lib/format.ts: "a clash gets -2 before
  the last extension, the same way every time"

### Requirement: Carry a manifest that reverses the flattening

Every exported gist SHALL hold `.playground.json`:
`{"version": 1, "name": <project name>, "files": {<gist name>: <path>},
"empty": [<path>]}`. Empty files, which a gist cannot hold, SHALL be listed in
`empty` and not uploaded. Opening the gist SHALL give back exactly the
exported paths and contents.

#### Scenario: Round trip (manual)

- **WHEN** a project's exportable files, including an empty `tests/.keep`, are
  flattened and then read back from the resulting gist files
- **THEN** the paths and contents equal the originals, and the project name is
  the one exported
- Pinned by client-v2/src/features/gist/lib/format.ts: "round trip keeps
  paths, contents and name"

#### Scenario: An unknown manifest version (manual)

- **WHEN** a gist's manifest says `"version": 2`
- **THEN** reading it fails with reason `unsupported-version`, and nothing is
  written
- Pinned by client-v2/src/features/gist/lib/format.ts: "rejects another
  manifest version"

### Requirement: Treat a gist's manifest as untrusted

Reading a gist SHALL fail, writing nothing, with a named reason when its
manifest is not valid JSON of the version-1 shape or lists one path twice,
maps a name to a path that is absolute, contains `.`, `..` or an empty
segment, or is one the export never writes, or names a gist file that is not
in the gist.

#### Scenario: A path that climbs out (manual)

- **WHEN** a manifest maps `x.rs` to `../../etc/x.rs`
- **THEN** reading fails with reason `unsafe-path`
- Pinned by client-v2/src/features/gist/lib/format.ts: "rejects the unsafe
  path %s"

#### Scenario: A manifest entry with no file (manual)

- **WHEN** a manifest maps `src__lib.rs` but the gist holds no such file
- **THEN** reading fails with reason `missing-file`
- Pinned by client-v2/src/features/gist/lib/format.ts: "rejects a manifest
  entry whose file is missing"

### Requirement: Place a hand-made gist's files by kind

A gist with no manifest SHALL be read file by file: Rust and Python files go
under `src/`, test files (`*.test.*` and `*.spec.*` of `ts` and `js`)
under `tests/`, other TypeScript and JavaScript files under `client/`, other
files of a supported language at the root, and files of a language the
Playground does not support are dropped. The result SHALL say which way the
files were placed (`manifest` or `loose`). A gist with no file left SHALL fail
with reason `no-supported-files`. `tsx` and `jsx` are not TypeScript or
JavaScript here: the Playground registers no language for them, so they are
dropped, and they take no `tests/` or `client/` place should one ever be
registered.

#### Scenario: A hand-made gist (manual)

- **WHEN** a gist without `.playground.json` holds `lib.rs`, `app.test.ts`,
  `client.ts` and `notes.docx`
- **THEN** reading gives `src/lib.rs`, `tests/app.test.ts` and
  `client/client.ts`, and no `notes.docx`
- Pinned by client-v2/src/features/gist/lib/format.ts: "places a hand-made
  gist's files by kind"

### Requirement: Create the gist on the server with the user's token

`POST /api/gists` SHALL require a signed-in session and a request from the
deployment's own origin, read the user's stored GitHub token on the server,
and create a gist whose visibility is the body's `public` field. A body
without `public` SHALL create a secret gist. The route SHALL never return the
token. It SHALL answer:

- `201 {url, id}` on success
- `401 {reason: "signed-out"}` without a session
- `403` for another origin
- `403 {reason: "needs-gist-scope"}` when the token lacks the `gist` scope
- `401 {reason: "github-unauthorized"}` when GitHub rejects the token
- `429` when GitHub rate-limits
- `413` over the size limit
- `400` for a malformed body, including a `public` that is not a boolean
- `422` when GitHub rejects the gist
- `502` for any other GitHub failure
- `503` when sign-in is not configured, or when the session or the stored
  token cannot be read for a reason other than a missing grant

#### Scenario: Creating a gist (manual)
- **WHEN** a signed-in user whose token has the `gist` scope posts a valid
  body with `public: false`
- **THEN** GitHub receives `POST /gists` with `public: false` and the files,
  and the route answers `201` with the gist's `html_url` and `id`
- Pinned by client-v2/api/gists.test.mjs and
  client-v2/src/features/gist/model/create-gist.test.mjs

#### Scenario: Creating a public gist (manual)
- **WHEN** the body carries `public: true`
- **THEN** GitHub receives `POST /gists` with `public: true`

#### Scenario: A body without visibility (manual)
- **WHEN** the body has no `public` field
- **THEN** GitHub receives `public: false`

#### Scenario: A visibility that is not a boolean (manual)
- **WHEN** the body carries `public: "yes"`
- **THEN** the route answers `400` and calls GitHub not at all

#### Scenario: A token without the scope (manual)
- **WHEN** GitHub answers `404` or `403` and its `X-OAuth-Scopes` header does
  not list `gist`
- **THEN** the route answers `403 {reason: "needs-gist-scope"}`
- Pinned by client-v2/src/features/gist/model/create-gist.test.mjs: "reads a
  404 from a token without the gist scope as needs-gist-scope"

#### Scenario: Signed out (manual)
- **WHEN** the request carries no session
- **THEN** the route answers `401 {reason: "signed-out"}` and calls GitHub not
  at all
- Pinned by client-v2/api/gists.test.mjs: "401s a signed-out request and never
  calls GitHub"

### Requirement: Measure the share flow

The `gist` slice SHALL send these events under the prefix `gist`:

- `gist_export_started` when the user presses Create secret gist or Create
  public gist, or the export resumes after sign-in, with `files` (count of
  exported files), `visibility` (`secret` | `public`) and `source` (`header`
  | `project_menu`, where the dialog was opened)
- `gist_export_scope_requested` when the dialog asks for gist access
- `gist_export_succeeded` with `files` and `visibility` when the gist is made
- `gist_export_failed` with `visibility` and a `reason`, one of `too-large`,
  `signed-out`, `sign-in-failed`, `needs-gist-scope`, `github-unauthorized`,
  `rate-limited`, `rejected`, `request-failed`, `read-failed` (the project
  could not be read, so no `gist_export_started` came before it)
- `gist_link_copied` when a copy of the Playground link in the shared state
  succeeds, with `copied: "playground"`

A sign-in the user cancels SHALL count as `gist_export_failed` with `reason:
"sign-in-failed"`. No event SHALL carry a file name, path, content, the gist's
id or URL, or a GitHub login.

#### Scenario: A successful share is counted
- **WHEN** a user opens Share from the header and shares a three-file project
  as a secret gist
- **THEN** `gist_export_started` is sent with `files: 3`, `visibility:
  "secret"`, `source: "header"`, and `gist_export_succeeded` with `files: 3`,
  `visibility: "secret"`

#### Scenario: A failure is counted by reason
- **WHEN** the route answers `429` for a public gist
- **THEN** `gist_export_failed` is sent with `reason: "rate-limited"`,
  `visibility: "public"`

#### Scenario: A copy is counted
- **WHEN** the user copies the Playground link
- **THEN** `gist_link_copied` is sent with `copied: "playground"`

### Requirement: A gist URL is recognised in every form GitHub hands out

The client SHALL accept as a gist URL `https://gist.github.com/<owner>/<id>`
and `https://gist.github.com/<id>`, either with a `#file-...` anchor,
`https://gist.github.com/<owner>/<id>/<revision>`, and
`https://gist.githubusercontent.com/<owner>/<id>/raw/...`, with or without
`https://`. A revision in the URL selects that revision of the gist. Any
other URL is not a gist URL.

#### Scenario: Owner, id and revision are read from the URL
- **WHEN** the URL is `https://gist.github.com/alice/0123abcd/9f8e7d`
- **THEN** it is a gist URL with owner `alice`, id `0123abcd` and revision `9f8e7d`

#### Scenario: A repository URL is not a gist URL
- **WHEN** the URL is `https://github.com/alice/repo`
- **THEN** it is not a gist URL, and repository import handles it as today

### Requirement: The import dialog imports a gist as a saved project

The GitHub import dialog (`import-github`) SHALL accept a gist URL as well
as a repository URL, and its field SHALL say so. Importing a gist SHALL
create a project named `gist-<owner>/<id>` (`gist-<owner>/<id>@<revision>`
for a URL naming a revision) and open it; when a project of that name
exists, it SHALL open that project and create none, and when the URL names
the owner it SHALL do so without a request to GitHub.

#### Scenario: Importing a gist from the dialog
- **WHEN** a signed-out user enters a public gist URL in the import dialog and presses Import
- **THEN** a project named `gist-<owner>/<id>` is created with the gist's files and opened

#### Scenario: Saving a gist opened from a link
- **WHEN** a user who opened a gist link imports the same gist URL from the dialog
- **THEN** a project named `gist-<owner>/<id>` is created and opened, beside the user's other projects

#### Scenario: Importing the same gist twice
- **WHEN** the user imports a gist whose project already exists
- **THEN** that project opens and no new project is created

### Requirement: A gist link opens the gist as a view

The client SHALL open `/gist/<id>`, and the playground URL followed by a
gist URL, as an unsaved view of the gist's files, the way `/{githubUrl}`
opens a repository.

#### Scenario: Opening a gist link signed out
- **WHEN** a signed-out user opens `/gist/<id>` for a public gist
- **THEN** the gist's files show in the explorer as an unsaved view and no project is created

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

### Requirement: Gist import is measured

The `features/gist` slice SHALL send, under the prefix `gist`:
`gist_import_started` when an import or a link starts reading a gist;
`gist_import_succeeded` when its files are read and laid out, before a
project is created or a view opened; `gist_import_failed`
when it stops. Each carries `from`: `dialog` or `link`. `gist_import_succeeded`
carries `layout`: `manifest` or `loose`. `gist_import_failed` carries
`reason`: `not-found`, `rate-limited`, `too-large`, `invalid`, `no-program`
or `request-failed`.

#### Scenario: A failed import is counted with its reason
- **WHEN** an import from the dialog fails because the gist does not exist
- **THEN** `gist_import_failed` is sent with `from: dialog` and `reason: not-found`

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

### Requirement: Share the open project from the header

On desktop, the frame's header SHALL carry a Share icon button (`flow-share`,
accessible name "Share <project name>", tooltip "Share as a gist") while a
project is open, a lesson included. It SHALL open the share dialog for the
open project. On a phone the header SHALL carry no Share button; the Code
head SHALL carry a Share icon button named "Share as a gist" beside the file
picker, which opens the same dialog, and the open project's row in the
project list stays a way in.

#### Scenario: Sharing from the header
- **WHEN** the project "counter" is open on desktop and the user presses
  Share in the header
- **THEN** the share dialog for "counter" opens, and nothing is sent to
  `/api/gists`

#### Scenario: No header Share on a phone
- **WHEN** a project is open below the phone breakpoint
- **THEN** no element with id `flow-share` is rendered

### Requirement: Copy the link once the gist is made

In the shared state, Copy link SHALL write the Playground link to the
clipboard, read "Copied", and show the toast "Link copied". A clipboard that
refuses SHALL show no toast, and the dialog SHALL say the link could not be
copied.

#### Scenario: Copying the Playground link
- **WHEN** the gist is made and the user presses Copy link
- **THEN** the clipboard holds `<origin>/gist/<id>` and a "Link copied" toast
  shows

### Requirement: Head the gist with the project's name

Every exported gist SHALL hold a file named `!` followed by the project's name, with `/` replaced by `__`, trimmed and cut to 60 code points. It sorts ahead of the manifest, so GitHub heads the gist's page with it. A project file of the same name SHALL get a counter. The share dialog SHALL name this file beside the manifest. An import SHALL NOT write it, and a gist without it SHALL open as before.

#### Scenario: The title sorts first (manual)

- **WHEN** a project named `counter` holding `.env.example` and `Anchor.toml` is flattened
- **THEN** the first of the gist's names in byte order is `!counter`
- Pinned by client-v2/src/features/gist/lib/format.ts: "titles the gist after the project: its file sorts first"

#### Scenario: An import leaves it out (manual)

- **WHEN** a gist is read back, with the title file or without it
- **THEN** the title file is not among the project's files, and the paths and name are the exported ones
- Pinned by client-v2/src/features/gist/lib/format.ts: "an import leaves the title out, and a gist without one opens"
