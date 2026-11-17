# Spec Delta

## MODIFIED Requirements

### Requirement: Signing in again keeps the work and the place

After a session ended, the account menu's first sign-in item SHALL read "Sign in again" and start the same sign-in as "Sign in with GitHub"; offline it reads "You're offline" and is disabled, and after a failure it reads "Try again". The session's end SHALL delete, reload and upload nothing. When the same account signs in again, in this tab or another, the open project SHALL stay open, and edits made meanwhile SHALL upload with no question unless another device changed the same project. The session's end SHALL NOT close the assistant's open thread. When another account signs in, the client SHALL stop the assistant's running turn, close its thread, and keep every chat thread of the account whose session ended on the device but out of the new account's upload and out of its assistant panel; that account's threads SHALL upload to it only, the next time it signs in. Otherwise another account's sign-in is an ordinary sign-in.

#### Scenario: Signing in again
- **WHEN** a person edits a project after the session ended and presses "Sign in again"
- **THEN** the row shows the @login, the same project stays open, the edit uploads, and no question is asked

#### Scenario: Another account after a session ended
- **WHEN** account A chats in a project, A's session ends without a sign-out, and account B signs in on the same browser
- **THEN** no request to `/api/conversations` carries A's thread, and the assistant panel no longer shows A's messages

#### Scenario: The first account returns after another signed out (manual)
- **WHEN** account B, having signed in after A's session ended, signs out, and A signs in again
- **THEN** A's conversation is back in the assistant panel on its project and uploads to A
