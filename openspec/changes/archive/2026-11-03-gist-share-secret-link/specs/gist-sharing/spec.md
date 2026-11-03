# Spec Delta

## ADDED Requirements

### Requirement: Share the open project from the header

On desktop, the frame's header SHALL carry a Share button (`flow-share`,
visible text "Share", accessible name "Share <project name>") while a project
is open, a lesson included. It SHALL open the share dialog for the open
project. On a phone the
header SHALL carry no Share button. There, the open project's row in the
project list is the way in.

#### Scenario: Sharing from the header
- **WHEN** the project "counter" is open on desktop and the user presses
  Share in the header
- **THEN** the share dialog for "counter" opens, and nothing is sent to
  `/api/gists`

#### Scenario: No header Share on a phone
- **WHEN** a project is open below the phone breakpoint
- **THEN** no element with id `flow-share` is rendered

### Requirement: Copy the Playground link

In the shared state, each copy action SHALL write its value to the clipboard
and show the toast "Link copied". A clipboard that refuses SHALL show no
toast, and the dialog SHALL say the link could not be copied.

#### Scenario: Copying the Playground link
- **WHEN** the gist is made and the user presses the link's copy button
- **THEN** the clipboard holds `<origin>/gist/<id>` and a "Link copied" toast
  shows

#### Scenario: Copying the GitHub link
- **WHEN** the user presses "Copy GitHub link"
- **THEN** the clipboard holds the gist's GitHub URL and a "Link copied"
  toast shows

## MODIFIED Requirements

### Requirement: Share a project from its menu

The row of the project that is open SHALL offer **Share** in its actions
menu, with the key hint `G`. Choosing it, by click or by the key while the
menu is open, SHALL open the share dialog for that project. The dialog is
named `share-gist` and titled "Share to GitHub". The row of any other project
or lesson SHALL NOT offer Share, and `G` SHALL do nothing in its menu.

#### Scenario: Opening the share dialog from the menu
- **WHEN** "counter" is the open project and the user opens its row's actions
  menu and picks Share
- **THEN** a dialog titled "Share to GitHub" opens for "counter"

#### Scenario: Opening the share dialog by its key
- **WHEN** the open project's actions menu is open and the user presses `G`
- **THEN** the share dialog for that project opens

#### Scenario: Another project's row
- **WHEN** the user opens the actions menu of a project that is not open
- **THEN** the menu has no Share item, and pressing `G` opens no dialog

### Requirement: Say what will be published before publishing

Before anything is sent, the dialog SHALL offer a choice of visibility, a
radio group named "Visibility" with the options Secret
(`share-gist-visibility-secret`) and Public (`share-gist-visibility-public`).
Secret SHALL be selected each time the dialog opens. A help tip by the group
SHALL say "Secret gists don't show on your profile. Anyone with the link can
open them." The dialog SHALL say that the program keypair and the project's
workspace settings stay in the browser. The primary button SHALL read "Share
to GitHub", and "Sharing to GitHub…" while the request runs, with the
visibility choice locked. Nothing SHALL reach GitHub until the user presses
that button.

#### Scenario: Nothing is sent on open
- **WHEN** the share dialog opens
- **THEN** no request to `/api/gists` has been made, Secret is selected, and
  the dialog shows a "Share to GitHub" button

#### Scenario: Sharing a public gist
- **WHEN** the user picks Public and presses "Share to GitHub"
- **THEN** the request to `/api/gists` carries `public: true`

#### Scenario: Sharing with the default
- **WHEN** the user presses "Share to GitHub" without touching the choice
- **THEN** the request to `/api/gists` carries `public: false`

### Requirement: Sign in to share

A signed-out user who opens the share dialog SHALL first see a sign-in prompt
in its place, titled "Sign in to share", saying "Your project goes to a gist on
your GitHub account.", with a "Sign in with GitHub" button that shows the
GitHub mark and a Cancel button (on a phone, the page's Close). Once the
sign-in succeeds the same dialog SHALL become the share dialog for the same
project, and nothing SHALL reach GitHub until the user presses "Share to
GitHub". A signed-in user SHALL go straight to the share dialog. A session
that ends while the share dialog is open SHALL still be mended from inside
the dialog, which offers to sign in again and then shares with the
visibility the user chose, without a second press.

While a sign-in or the gist-access popup waits for GitHub, the primary
button of the prompt or the dialog SHALL read "Cancel sign-in" (in the share
dialog, `share-gist-cancel-sign-in`; in the prompt, the frame's submit), as
the prototype's own sign-in control does.
Pressing it SHALL stop the wait and keep the dialog open on the step it came
from (the prompt, signing in again, or allowing gists), saying "Sign-in
cancelled.", with the button back to its own label, which starts a new
sign-in. The frame's Cancel SHALL stay available too: it closes the dialog
and cancels the sign-in. A sign-in that ends without a session SHALL keep
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
- **THEN** the dialog becomes "Share to GitHub" with Secret selected and a
  "Share to GitHub" button, and no request to `/api/gists` has been made

#### Scenario: Signed in, no prompt
- **WHEN** a signed-in user picks Share
- **THEN** the dialog opens titled "Share to GitHub", without the prompt

#### Scenario: Sign-in cancelled
- **WHEN** the user presses "Sign in with GitHub" and, while the popup waits
  and the button reads "Cancel sign-in", presses it
- **THEN** the sign-in stops, the dialog stays open on the prompt saying
  "Sign-in cancelled.", no gist is created, and pressing "Sign in with
  GitHub" starts a new sign-in

#### Scenario: Closing the dialog while sign-in waits
- **WHEN** the user presses "Sign in with GitHub" and, while it waits,
  presses the frame's Cancel
- **THEN** the sign-in stops, the dialog closes, and no gist is created

#### Scenario: A sign-in that cannot start
- **WHEN** the user presses "Sign in with GitHub" and sign-in cannot start
- **THEN** the prompt stays open and says "Could not start sign-in", and no
  gist is created

#### Scenario: Cancel leaves without signing in
- **WHEN** the user presses Cancel in the prompt
- **THEN** the dialog closes and no sign-in starts

### Requirement: Show the gist when it is made

On success the dialog SHALL show the heading "Shared". It SHALL show the
Playground link `<origin>/gist/<id>`, where `<id>` is the gist's id, in a
read-only field labelled "Playground link", with a copy button labelled "Copy
Playground link". Under it SHALL come the line "Opens <project name> in
Solana Playground as a preview. Anyone with the link can see the code." The
dialog SHALL show an "Open on GitHub" link that opens the gist in a new tab,
and a secondary "Copy GitHub link" button. The gist's own URL SHALL NOT be
shown as the link to send.

#### Scenario: Successful share
- **WHEN** `/api/gists` answers `201` with the URL `https://gist.github.com/a/b`
  and id `b`
- **THEN** the dialog shows `<origin>/gist/b` in the Playground link field,
  and Open on GitHub links to `https://gist.github.com/a/b` with
  `target="_blank"` and `rel="noopener noreferrer"`

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

- `gist_export_started` when the user presses Share to GitHub, or the export
  resumes after sign-in, with `files` (count of exported files), `visibility`
  (`secret` | `public`) and `source` (`header` | `project_menu`, where the
  dialog was opened)
- `gist_export_scope_requested` when the dialog asks for gist access
- `gist_export_succeeded` with `files` and `visibility` when the gist is made
- `gist_export_failed` with `visibility` and a `reason`, one of `too-large`,
  `signed-out`, `sign-in-failed`, `needs-gist-scope`, `github-unauthorized`,
  `rate-limited`, `rejected`, `request-failed`
- `gist_link_copied` when a copy in the shared state succeeds, with `copied`
  (`playground` | `github`)

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
