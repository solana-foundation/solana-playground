# Spec Delta

## ADDED Requirements

### Requirement: A session is expired only if nobody signed out

The client SHALL treat a session read that finds nobody (a 401, or JSON with no user) as a session that ended when this browser's last session was not ended by an accepted sign-out, in any tab. An HTML page, a 404 or a not-configured answer SHALL NOT read as an ended session. A 401 from `/api/projects` or `/api/conversations` SHALL prompt a session read and SHALL NOT end the session by itself.

#### Scenario: A sign-out in another tab
- **WHEN** a person signs out in one tab, and another tab then reads the session
- **THEN** that other tab reads "Sign in" over "Saved in this browser"

#### Scenario: A tab opened after the session ended (manual)
- **WHEN** a person reopens Playground after the session cookie expired, not having signed out
- **THEN** the account row reads the account's name over "Your session ended"

### Requirement: Signing in again keeps the work and the place

After a session ended, the account menu's first sign-in item SHALL read "Sign in again" and start the same sign-in as "Sign in with GitHub"; offline it reads "You're offline" and is disabled, and after a failure it reads "Try again". The session's end SHALL delete, reload and upload nothing. After the sign-in the open project SHALL stay open, and edits made meanwhile SHALL upload with no question unless another device changed the same project.

#### Scenario: Signing in again
- **WHEN** a person edits a project after the session ended and presses "Sign in again"
- **THEN** the row shows the @login, the same project stays open, the edit uploads, and no question is asked

## MODIFIED Requirements

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
- signed in while the browser reports no network: "Offline · saving here";
- a session that ended without a sign-out: the last account's avatar and name
  stay, over the line "Your session ended", in warning tone (`text-warning-ink`), online or
  offline, until the next sign-in. A sign-in under way, or a failure the
  person did not cancel, says its own line meanwhile.

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

#### Scenario: A session ended
- **WHEN** a signed-in person's session expires on the server and an upload answers 401
- **THEN** the account row reads the account's name over "Your session ended", with no reload, and the `aria-label` is "Account: <login>, session ended"

#### Scenario: A session ended, offline (manual)
- **WHEN** the browser is offline and the session has ended
- **THEN** the account row still reads "Your session ended"

#### Scenario: Signed in and offline (manual)
- **WHEN** a signed-in person's browser goes offline
- **THEN** the account row's line reads "Offline · saving here", and goes back to the @login when the network returns

### Requirement: Project rows say when a project is not in the account

Signed in, or after a session that ended without a sign-out, with sync available, each project row in the navigation SHALL
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

#### Scenario: Markers stay after a session ended (manual)
- **WHEN** a session ends and the person edits a project the account holds
- **THEN** other projects keep their markers, and the edited one shows "Not synced"

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
