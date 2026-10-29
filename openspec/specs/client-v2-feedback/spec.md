# client-v2-feedback Specification

## Purpose
How a person using `client-v2` sends the team feedback from inside the
product: its entries in the account menu, the form, what reaches Sentry, and
the events `features/feedback` sends.

## Requirements

### Requirement: The account menu offers feedback

The account menu at the foot of the navigation (and beside its rail) SHALL
carry the feedback entries, after "Settings" and "Docs": "Share feedback"
where feedback can be sent, and "Report a bug". It SHALL NOT carry
"Suggest an idea", which only the form offers. There
SHALL be no separate feedback button. The form, its draft and its send SHALL
be held above the navigation, so they outlive the menu: below 768 px the
footer is on the menu page, and the rail swaps the footer for its own. A
send in flight SHALL show on the account row and on the rail's "Account".
An open modal SHALL cover the account row.

#### Scenario: The menu opens

- **WHEN** the user opens the account menu
- **THEN** it holds "Report a bug", with "Share feedback" before it where
  feedback can be sent, and no "Suggest an idea"

#### Scenario: A modal covers the account row (manual)

- **WHEN** the feedback form, or any other modal, is open
- **THEN** the account row is under the modal's overlay and cannot be
  pressed

### Requirement: Share feedback is offered only where feedback can be sent

The menu SHALL offer "Share feedback" only in a build that carries Sentry: a
DSN is set and the build reports (production, or a preview with
`SENTRY_PREVIEW_ENABLED=true`). Every other build SHALL show the account
menu with "Report a bug" only.

#### Scenario: A local build

- **WHEN** the app runs locally with `REACT_APP_SENTRY_DSN` set and no
  `VERCEL_ENV`
- **THEN** the menu shows "Report a bug" and no "Share feedback"

#### Scenario: A production build (manual)

- **WHEN** the build has a DSN and `VERCEL_ENV=production`
- **THEN** the menu shows "Share feedback"

### Requirement: The GitHub links open the Foundation's issue list

"Report a bug" in the menu, and "Suggest an idea" and "Report a bug" under
the form's submit button, SHALL each open
`https://github.com/solana-foundation/solana-playground/issues` in a new tab
with `rel="noopener noreferrer"`.

#### Scenario: Report a bug from the menu

- **WHEN** the user picks "Report a bug" in the menu
- **THEN** a new tab opens on the issue list

#### Scenario: Report a bug from the form (manual)

- **WHEN** the user presses "report a bug" under the form
- **THEN** a new tab opens on the issue list and the form stays open

### Requirement: The form takes a rating, a message and an optional handle

"Share feedback" SHALL open a modal titled "Give feedback" with a rating, a
message and a contact field. The modal is a dialog on a wide screen and a
page of its own on a phone. What the user typed and the stars they chose
SHALL be kept, across closing and opening the form, until a send succeeds.
While a send is in progress, Submit SHALL be disabled and the fields SHALL
be read-only; the form MAY be closed, and the account row (on the rail,
"Account") SHALL then show a spinner labelled "Sending feedback", inside a
halo that pulses where the user allows motion, until the send ends.

- Rating: a `radiogroup` with the `aria-label` "Rating" of five radios, each
  labelled "N of 5 stars"; optional; the chosen star and those before it are
  filled with the primary colour.
- Message: a `textarea` with id `feedback-message`, label "Feedback",
  required, at most 4096 characters.
- Contact: an input with id `feedback-contact`, label "X handle (optional)",
  at most 16 characters.

#### Scenario: Closing mid-send (manual)

- **WHEN** the user presses Escape or the close button while a send is in
  progress
- **THEN** the form closes, focus returns to the account row, and the row
  shows the spinner and the pulsing halo until the send ends

#### Scenario: An empty message (manual)

- **WHEN** the user presses Submit with no message, or a message of only spaces
- **THEN** the browser refuses the form and nothing is sent

#### Scenario: Arrow keys move the rating (manual)

- **WHEN** the rating has focus and the user presses the right arrow
- **THEN** the next star is chosen

#### Scenario: A closed form keeps its draft (manual)

- **WHEN** the user picks three stars, types a message, closes the form and
  opens it again
- **THEN** the three stars and the message are as the user left them

#### Scenario: A draft outlives the menu page (manual)

- **WHEN** on a 375 px window the user opens "Menu", opens the form from the
  account menu, types a message, closes the form, goes back to Work, and
  opens the menu and the form again
- **THEN** the message is as the user left it, and a send still in flight
  shows on the account row

### Requirement: One browser module imports the Sentry SDK

Only `shared/lib/reporter/sentry.ts` SHALL import `@sentry/react` among the
non-test files under `client-v2/src`; the feedback slice and the logger reach
Sentry through `shared/lib/reporter`. A build that does not report SHALL
bundle no Sentry SDK code, because craco swaps that one module for its stub.

#### Scenario: A second importer (manual)

- **WHEN** a non-test file under `client-v2/src` other than the reporter
  imports `@sentry/react`
- **THEN** `src/app/slice-structure.test.ts` fails and names the file

### Requirement: A sent form reaches Sentry as user feedback

Submitting SHALL send one Sentry user feedback with the message, the handle
as its name when given, and `source` "widget". It SHALL carry the tags
`type` "feedback", `source` "widget", `rating` (1 to 5, absent when no star
is chosen) and `cluster` (the connected cluster). The tags SHALL NOT remain
on events sent after it.

#### Scenario: A rated message (manual)

- **WHEN** the user gives four stars and the message "Deploy is slow" and
  submits
- **THEN** Sentry receives one feedback with message "Deploy is slow" and tag
  `rating` 4

#### Scenario: Tags stay on the feedback (manual)

- **WHEN** an error is reported to Sentry after a feedback was sent
- **THEN** the error carries no `rating` tag and no `type` "feedback" tag

### Requirement: The outcome of a send is shown to the user

A send that Sentry accepts SHALL close the form, clear what was typed, and
show a success toast "Feedback sent!". A send that fails SHALL keep what was
typed. While the form is open it SHALL show, inside the form, an alert
"Could not send feedback" that points at the GitHub links, not a toast in the
corner, away from the form. While the form is closed it SHALL show a
toast "Could not send feedback." that points the user back at the form, and
the alert SHALL show when the form opens again.

#### Scenario: Sentry accepts the feedback (manual)

- **WHEN** the send resolves
- **THEN** the form closes and the success toast shows

#### Scenario: The send fails (manual)

- **WHEN** the send rejects while the form is open
- **THEN** the form stays open with the message the user typed, Submit is
  enabled again, and the alert shows in the form

#### Scenario: The send fails behind a closed form (manual)

- **WHEN** the user closes the form mid-send and the send rejects
- **THEN** the failure toast shows, and the form opens again with the
  message the user typed and the alert

### Requirement: Feedback use is tracked

`features/feedback` SHALL track these events and no parameters beyond those
listed. No event SHALL carry the message or the handle.

- `feedback_opened`: the form opened. No parameters.
- `feedback_sent`: Sentry accepted a feedback. `rating`, one of `1` to `5`,
  or `none` when no star was chosen.
- `feedback_failed`: a send was rejected. No parameters.
- `feedback_github_clicked`: a GitHub link was opened. `link`, one of `idea`
  or `bug`; `from`, one of `menu` or `form`.

#### Scenario: A sent feedback (manual)

- **WHEN** the user opens the form and sends it with no star
- **THEN** `feedback_opened` and then `feedback_sent` with rating `none` are
  tracked

#### Scenario: A failed send (manual)

- **WHEN** the send rejects
- **THEN** `feedback_failed` is tracked and the failure is reported under
  `feedback:form`

#### Scenario: A link from the menu

- **WHEN** the user picks "Report a bug" in the menu
- **THEN** `feedback_github_clicked` with link `bug` and from `menu` is
  tracked
