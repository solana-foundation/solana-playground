# Proposal

## Why

HOO-1736: a signed-in user who signs out and keeps talking to the assistant is
never told that the conversation now lives only in this browser. Sign-out also
says the opposite of what it does: the dialog reads "Your projects and chats
stay in this browser and stop syncing", while sign-out removes from the browser
every chat and project the account already holds (`PgChatSync.handOver`,
`releaseLocalProjects`) and keeps only what never reached it.

The designers' specs settle both strings. [Spec 02](https://linear.app/hoodies/document/spec-02-account-sign-in-saved-work-and-the-profile-065dc4fd844b)
("Account copy") gives the sign-out dialog;
[Spec 08](https://linear.app/hoodies/document/spec-08-failure-and-empty-states-the-catalogue-bb9694459ccc)
("Assistant failures", AI-11) gives a line at the foot of the thread for a
signed-out person.

## What Changes

- The sign-out dialog reads "Sign out of Playground?" and "Projects saved to
  your account leave this browser. Anything not saved stays here.", with focus
  on Cancel when it opens.
- Signed out, on a deployment that syncs, a thread with messages ends in a line
  "Sign in to keep this conversation on your other devices." with a "Sign in
  with GitHub" button that signs in from the panel (no jump to another project
  afterwards, as for Connect a model's sign-in).
- Telemetry: the `assistant` slice adds `assistant_sign_in_offered_clicked`.
  The sign-in itself is already measured by `auth` (`auth_sign_in_started`,
  `auth_sign_in_failed`, `auth_signed_in`).
- `features/persistence` exports `PgSyncClient` through its public API, so the
  panel can ask whether the deployment syncs at all.

## Capabilities

### New Capabilities

- `assistant-sign-out-history`: what the person is told about where the
  assistant's history is kept when they sign out or are signed out.

### Modified Capabilities

None.

## Impact

- `client-v2/src/widgets/session-footer/ui/BaseSignOutDialog.tsx`: strings.
- `client-v2/src/widgets/assistant/ui/` (`Thread`, `BaseThread`) and
  `widgets/assistant/model/telemetry.ts`: the AI-11 line and its event.
- `client-v2/src/features/persistence/index.ts`: one export.
- `client-v2/src/features/auth/model/session.ts`: `PgSession.afterRead`, a
  wait on the page's session read that never starts one.

Out of scope:

- Spec 02's "{n} projects stayed in this browser because they weren't saved to
  your account." after sign-out, and the "Session ended" / "GitHub access
  removed" states: separate account work.
- Spec 08's other assistant failure states (AI-01 to AI-10, AI-12).
- Any server change: sign-out already hands everything over before it clears.
