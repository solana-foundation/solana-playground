## MODIFIED Requirements

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
with the manifest, and say that the program keypair and workspace settings
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
  `rate-limited`, `rejected`, `request-failed`
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

## ADDED Requirements

### Requirement: Copy the link once the gist is made

In the shared state, Copy link SHALL write the Playground link to the
clipboard, read "Copied", and show the toast "Link copied". A clipboard that
refuses SHALL show no toast, and the dialog SHALL say the link could not be
copied.

#### Scenario: Copying the Playground link
- **WHEN** the gist is made and the user presses Copy link
- **THEN** the clipboard holds `<origin>/gist/<id>` and a "Link copied" toast
  shows

## REMOVED Requirements

### Requirement: Copy the Playground link

**Reason**: The shared step has one copy action, Copy link in the footer; the
"Copy GitHub link" button is gone with DES-206.

**Migration**: "Copy the link once the gist is made" covers the Playground
link; the gist's GitHub URL is reached through "Open the gist on GitHub".
