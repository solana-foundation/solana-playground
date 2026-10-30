# assistant-sign-out-history Specification

## Purpose
What the person is told, when they sign out or are signed out, about where the
assistant's conversation is kept: in this browser only, or in the account too.

## Requirements

### Requirement: Sign-out says what leaves the browser

The sign-out dialog SHALL be titled "Sign out of Playground?" and SHALL read
"Projects saved to your account leave this browser. Anything not saved stays
here." Its Cancel button SHALL hold focus when the dialog opens. The buttons
keep their names, "Cancel" and "Sign out".

#### Scenario: The sign-out dialog

- **WHEN** a signed-in person picks Sign out in the account menu
- **THEN** a dialog titled "Sign out of Playground?" reads "Projects saved to your account leave this browser. Anything not saved stays here."
- **AND** "Cancel" has focus

### Requirement: A signed-out thread offers sign-in

While nobody is signed in and the deployment accepts sync, a thread holding at
least one item SHALL end in a status line reading "Sign in to keep this
conversation on your other devices." with a "Sign in with GitHub" button. The
button SHALL start a sign-in from the assistant (`PgSession.signIn` with
`from: "assistant"`), so a successful sign-in keeps the open project, and SHALL
be disabled while a sign-in is pending. A failed sign-in is shown where every
other sign-in failure is, on the account row. The line SHALL NOT show while
signed in, on an empty thread, or on a deployment without sync. It is drawn
from state, never stored in or synced with the thread. A sign-out in this tab
closes the open thread, so there the line appears with the next thread that
holds messages.

#### Scenario: Signed out with a conversation

- **WHEN** a signed-out person on a deployment that syncs has a thread with messages
- **THEN** the thread ends in "Sign in to keep this conversation on your other devices." and a "Sign in with GitHub" button

#### Scenario: Signed in, or nothing to keep

- **WHEN** the person is signed in, the thread is empty, or the deployment does not sync
- **THEN** the line is not shown

#### Scenario: The session ends with a conversation open (manual)

- **WHEN** the session ends while a thread with messages is open (an expiry, or a sign-out in another tab)
- **THEN** the open thread ends in "Sign in to keep this conversation on your other devices." without a reload

### Requirement: The sign-in line's click is measured

The `assistant` slice SHALL send `assistant_sign_in_offered_clicked`, with no
parameters, each time the person presses "Sign in with GitHub" on the thread's
sign-in line. The sign-in's outcome is `auth`'s events.

#### Scenario: Pressing the line's button

- **WHEN** the person presses "Sign in with GitHub" on the thread's sign-in line
- **THEN** `assistant_sign_in_offered_clicked` is sent once
