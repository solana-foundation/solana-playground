# client-v2-handoff Specification

## Purpose

Lets a person on a phone take the project they are on to a computer: where
the way out shows, what it tells them, and the link it hands over.

## Requirements

### Requirement: The way to a computer shows only on a phone

Below the phone breakpoint the menu page SHALL show a button named
"Continue on a computer" (test id `handoff-open`) in a group of its own at the
page's foot, drawn as one of the menu's rows and not as a project. At the
breakpoint and above, no such button SHALL be rendered.

#### Scenario: The phone's menu page offers it

- **WHEN** the window is 390 px wide and the menu page shows
- **THEN** a button named "Continue on a computer" is visible

#### Scenario: The frame does not

- **WHEN** the window is 1280 px wide
- **THEN** no button named "Continue on a computer" is in the page

### Requirement: The sheet gives a link to open on a computer

The button SHALL open a bottom sheet titled "Continue on a computer". Signed
in, it SHALL show a link (test id `handoff-link`): the app's origin and the
current path; "Copy link" SHALL copy it and then read "Copied", and where the
browser offers a share sheet, Share SHALL hand it the link. Signed out, the
sheet SHALL show no link, Copy or Share: a computer would open the link
without the project, which is on the phone alone. "Stay on the phone" SHALL
close the sheet. Every button in the sheet SHALL be at least 48 px tall.

#### Scenario: The link names this app and page

- **WHEN** a signed-in person opens the sheet on a page of the app
- **THEN** the link reads the app's origin followed by that page's path
- **AND** "Copy link" puts that link on the clipboard and reads "Copied"

### Requirement: The sheet says what moves with the person

Signed in, the sheet SHALL say their files and this conversation go with
them and name the GitHub login to sign in with on the computer. Signed out,
it SHALL say the project stays on this phone, without telling the person to
open a link while none is shown, and offer "Sign in with GitHub",
with the GitHub mark, as its one action; it starts the sign-in, and once
signed in the sheet reads as signed in.

#### Scenario: Signed in

- **WHEN** a person signed in as `ada` opens the sheet
- **THEN** it says the project is in their account and to sign in with GitHub as `@ada`

#### Scenario: Signed out

- **WHEN** a signed-out person opens the sheet
- **THEN** it says the project stays on this phone
- **AND** it shows a "Sign in with GitHub" button and no link

### Requirement: The hand-off is measured

The `app-nav` slice SHALL send `nav_handoff_opened` when the sheet opens,
with `signed_in` (`true` or `false`); `nav_handoff_link_copied` when Copy
succeeds; and `nav_handoff_link_shared` when the share sheet resolves (not
when it is cancelled). None
carries the link or the login.

#### Scenario: Opening is counted

- **WHEN** a signed-out person opens the sheet
- **THEN** `nav_handoff_opened` is sent with `signed_in: false`
