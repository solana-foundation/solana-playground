# client-v2-account Specification

## Purpose
What the account row, the account menu's sign-in group and the sign-out
question say in each sign-in state, and where each project in the
navigation says its work lives, as Spec 02 sets them.

## Requirements

### Requirement: The account row says who and where

The account row at the foot of the navigation (`aria-label` "Account,
signed out" or "Account: <login>") SHALL show an avatar or a blank disc, a
name or "Sign in", and one second line:

- signed out: "Saved in this browser";
- while a sign-in runs: the name reads "Signing in…" and the line "Waiting
  for GitHub…", with the row's Cancel;
- after a failed sign-in the person did not cancel: "Couldn't sign in", as
  the prototype draws it, with the reason in full in its `title` and in the
  account menu;
- signed in: the GitHub display name over the @login;
- signed in while the browser reports no network: "Offline · saving here".

The wallet is not on the account row; it stays in the menu's wallet group.

#### Scenario: Signed out on a clean browser (manual)
- **WHEN** a person opens Playground signed out
- **THEN** the account row reads "Sign in" over "Saved in this browser", with or without a wallet connected

#### Scenario: A sign-in under way (manual)
- **WHEN** the person presses Sign in with GitHub and the popup is open
- **THEN** the account row reads "Signing in…" over "Waiting for GitHub…" with a Cancel action, and the account menu reads "Waiting for GitHub…" with "Cancel sign-in"

#### Scenario: The row after sign-in (manual)
- **WHEN** account A's sign-in completes
- **THEN** the row shows A's avatar, display name and @login

#### Scenario: Signed in and offline (manual)
- **WHEN** a signed-in person's browser goes offline
- **THEN** the account row's line reads "Offline · saving here", and goes back to the @login when the network returns

### Requirement: Sign-in failures say why

A sign-in that fails SHALL leave the person signed out, and the account
menu SHALL say why with one of: "Allow popups for this site to sign in."
(the popup was blocked), "Sign-in did not finish." (no answer in time, or
the session could not be read after GitHub answered), "Sign-in isn't
available. Your work is saved in this browser." (the server could not start
a sign-in, or the sign-in failed at no known step); the menu's sign-in item then reads "Try again". A cancelled
sign-in ("Sign-in cancelled.") leaves the menu as it was. Offline and signed
out, the menu's sign-in item SHALL be disabled and read "You're offline".
No raw string, such as "Could not start sign-in", reaches the person.

#### Scenario: The server cannot start a sign-in (manual)
- **WHEN** the person presses Sign in with GitHub on a build whose sign-in endpoint fails
- **THEN** the account menu says "Sign-in isn't available. Your work is saved in this browser." over "Try again", and the person stays signed out

#### Scenario: Offline, signed out (manual)
- **WHEN** the network is off and the person opens the account menu signed out
- **THEN** the sign-in item is disabled and reads "You're offline"

### Requirement: Sign-out asks in the menu and says what stayed

Sign out SHALL ask in place, inside the account menu: "Sign out of
Playground?" with the line "Projects saved to your account leave this
browser. Anything not saved stays here.", a destructive Sign out and a
Cancel that holds focus. Cancel SHALL return the menu to its items. On
confirm, the menu stays open while sign-out runs; when projects stay in the
browser afterwards, the menu SHALL say "{n} projects stayed in this browser
because they weren't saved to your account.", for one "1 project stayed in
this browser because it wasn't saved to your account." A
sign-out that fails SHALL leave the person signed in and say so. No
"Sign out of GitHub?" remains.

#### Scenario: Sign-out confirmation (manual)
- **WHEN** the person opens the menu and presses Sign out, then Cancel
- **THEN** "Sign out of Playground?" shows with the consequence line and focus on Cancel, then the menu's items return

#### Scenario: Sign-out with leftovers (manual)
- **WHEN** the person edits a synced project offline and signs out offline
- **THEN** sign-out completes, the menu says 1 project stayed, and the project keeps its edit

### Requirement: The account menu counts how sign-out ended

The session-footer slice SHALL emit `session_sign_out_ended` when the
sign-out question closes, with `outcome` (`ok`, `cancelled`) and, for `ok`,
`items_kept` (a whole number: the projects left in the browser). A question
closed by closing the menu counts as `cancelled`. A failed sign-out emits
nothing; the question stays open. A menu closed while its sign-out runs
emits nothing for the close: the sign-out is counted when it succeeds, and
one that then fails ends the question with no event.

#### Scenario: Cancelling counts once (manual)
- **WHEN** the person presses Sign out, then Cancel
- **THEN** one `session_sign_out_ended` with `outcome: "cancelled"` is sent

### Requirement: Project rows say when a project is not in the account

Signed in, with sync available, each project row in the navigation SHALL
show one marker, or none:

- "This browser": this account has no record of syncing the project here,
  so the project is only here;
- "Not synced": the account has the project, but it waits on a conflict
  the person has not answered, or holds work the account has not accepted:
  an upload pending or stopped. Online, a project the editor has just
  flagged is not read again until its upload has had time to land (10 s,
  past the editor's 3 s delay), so a pause in typing does not flash the
  marker; offline it is read at once;
- no marker: the account holds exactly what this browser holds.

Signed out, or where sync is not available, no row shows a marker. The
marker is text, so a screen reader reads it with the row. It gives way to
the row's actions while the row is hovered or focused, as the pin does.

#### Scenario: Signed out shows no markers (manual)
- **WHEN** a signed-out person has projects in the browser
- **THEN** no project row shows "This browser" or "Not synced"

#### Scenario: Another account's project on a shared browser (manual)
- **WHEN** account B signs in on a browser holding a project account A synced
- **THEN** that project's row shows "This browser" and it is never uploaded to B

#### Scenario: ACC-26 Signed in, offline (manual)
- **WHEN** signed in, the person goes offline and edits a synced project
- **THEN** the account row reads "Offline · saving here", the project shows "Not synced", and back online the marker clears with no question once the next upload or reconcile lands (an edit, a switch or a refocus)

#### Scenario: A conflict on another project (manual)
- **WHEN** a project has an unanswered sync conflict and the person opens another project
- **THEN** the first project's row shows "Not synced"
