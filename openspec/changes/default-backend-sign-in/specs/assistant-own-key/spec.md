# Spec Delta

## ADDED Requirements

### Requirement: The default backend needs a signed-in user

The keyless default backend spends the deployment's own key, so the panel SHALL
connect to it, and reconnect a remembered choice of it, only while a user is
signed in. A signed-out user SHALL see it tagged "sign-in needed", with a
**Sign in with GitHub** button in place of **Start**. When the session ends
while the panel is connected to it, the panel SHALL return to the picker. A
key-based backend SHALL NOT depend on the session.

#### Scenario: Signed out, the default backend offers sign-in

- **WHEN** a signed-out user opens a project on a deployment that serves a
  default backend, with the default backend remembered from an earlier visit
- **THEN** the panel is not connected, the picker tags the default backend
  "sign-in needed" and not "no key needed", reads "Sign in with GitHub to use
  it, or bring your own key below.", and shows no **Start** button

#### Scenario: Signed in, the remembered default backend reconnects

- **WHEN** a signed-in user opens a project on a deployment that serves a
  default backend, with the default backend remembered from an earlier visit
- **THEN** the panel connects to the default backend without showing the
  picker

#### Scenario: Signing out while connected to the default backend

- **WHEN** a signed-in user connected to the default backend signs out from
  the header
- **THEN** the panel shows the picker with the default backend tagged
  "sign-in needed", and the composer `Message the assistant` is hidden

#### Scenario: The session ends mid-chat on the default backend

- **WHEN** the session of a user connected to the default backend ends
  outside this tab (it expires, or another tab signs out) and the user sends a
  message
- **THEN** the chat shows "Sign in with GitHub to use the default backend.",
  then the panel shows the picker with the default backend tagged
  "sign-in needed", and the composer `Message the assistant` is hidden

#### Scenario: Signing out leaves a key-based backend connected (manual)

- **WHEN** a signed-in user connected to a key-based backend signs out
- **THEN** the panel stays in the chat on the same backend with the same key

Checked by the unit test "leaves a key-based backend alone when the session
ends" in `client-v2/src/views/sidebar/assistant/store.test.ts`.

### Requirement: A sign-in from the assistant panel keeps the open project

A sign-in started from the assistant picker SHALL leave the open project open.
A sign-in from the header SHALL still open the account's most recently changed
project.

#### Scenario: Signing in from the panel keeps the open project (manual)

- **WHEN** a signed-out user with a project open presses
  **Sign in with GitHub** in the assistant picker and completes the sign-in
- **THEN** the same project stays open, where a sign-in from the header opens
  the account's most recently changed project

Checked by the unit test "keeps the open project when the sign-in started in
the assistant panel" in `client-v2/src/effects/session/session.test.ts`.
