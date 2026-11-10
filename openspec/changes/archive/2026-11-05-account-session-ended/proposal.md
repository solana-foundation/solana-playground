# Proposal

## Why

A session can end without the person signing out, and the client says nothing: the row turns to "Saved in this browser", sync stops, and edits made after that do not upload on the next sign-in unless the project is edited again. Almaz's design review of the account row (DES-197) and Spec 02 both ask for "Your session ended" before Breakpoint (HOO-2624).

## What Changes

- The client tells a session that expired from a sign-out: a session read that finds nobody, in a browser where nobody signed out, is an expired session. A sign-out in another tab is not one, and a tab reopened after the cookie expired still is.
- A 401 from a sync route asks for that session read, so the row changes within one sync attempt.
- The account row keeps the last account's avatar and name, over "Your session ended" in warning tone, even offline. The menu's first item reads "Sign in again".
- While the session is expired the project markers stay and edits are still flagged, so they show "Not synced" and upload with no prompt after the sign-in. Nothing uploads meanwhile.
- "Sign in again" keeps the open project: it does not open the account's newest one.
- Telemetry: `features/auth` adds `auth_session_expired`. `widgets/session-footer` adds no event: "Sign in again" counts as the `sign-in` item of `session_account_item_picked`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-account`: the account row gains the session-ended line, the menu "Sign in again", and project rows keep their markers while a session is expired.
- `client-v2-auth`: the new event `auth_session_expired`.

## Impact

Code: `features/auth/model/session.ts`, `features/persistence/model/{project-sync,chat-sync,sync-mark,sync-marker}.ts`, `effects/session/session.tsx`, `widgets/session-footer`.

Browser storage: one small `localStorage` value holding the signed-in account's id, name, login and avatar URL, removed by an accepted sign-out.

Out of scope: refreshing or extending sessions, a read on refocus, "GitHub access removed" (Spec 02 flow 9, a separate state), and any server change. After a reload, edits made while expired have no merge base, so if another device changed the same file meanwhile, the merge asks about that whole file.
