# Spec Delta

## Purpose

**Area:** the account menu's Delete account question and `DELETE /api/account` (client-v2 UI, client-v2 API)

What deleting an account removes from the database, the build audit, GitHub
and the browser, so a signed-in person can have Playground erase what it holds
about them.

## ADDED Requirements

### Requirement: Deleting an account removes every row that holds its id

`DELETE /api/account` SHALL, for the signed-in user, delete their `user` row in
one transaction, so that no row in `user`, `account`, `session`, `projects`,
`project_files`, `conversations`, `messages`, `agent_spend` or `agent_turn`
holds their id afterwards. It SHALL answer `200` on success.

#### Scenario: A user with projects, chats and AI turns (manual)
The route against Postgres: pinned by `client-v2/api/account.test.mjs` under `yarn test-api`.
- **WHEN** a signed-in user who has synced projects, conversations, `agent_spend` and `agent_turn` rows calls `DELETE /api/account`
- **THEN** the route answers `200` and none of those tables holds a row with the user's id

#### Scenario: Another user's rows stay (manual)
The route against Postgres: pinned by `client-v2/api/account.test.mjs` under `yarn test-api`.
- **WHEN** user A deletes their account
- **THEN** every row of user B in those tables is unchanged

### Requirement: Deleting an account removes the GitHub identity from the build audit

In the same transaction, the route SHALL set `login` and `github_id` to null
on every `build_audit` row of the user. The rest of each row stays.

#### Scenario: Build audit rows after deletion (manual)
The route against Postgres: pinned by `client-v2/api/account.test.mjs` under `yarn test-api`.
- **WHEN** a user with `build_audit` rows deletes their account
- **THEN** those rows still exist, and none holds the user's `login` or `github_id`

#### Scenario: A failed deletion changes nothing (manual)
The route against Postgres: pinned by `client-v2/api/account.test.mjs` under `yarn test-api`.
- **WHEN** the transaction fails after the `build_audit` update
- **THEN** the route answers `500`, the `user` row and the `build_audit` identities are unchanged, and the error is reported

### Requirement: The account route refuses what it must not act on

The route SHALL answer `401` without a session, `403` when `isAllowedOrigin`
refuses the request, `405` with an `Allow: DELETE` header for any other
method, and `503` when sign-in is not configured.

#### Scenario: No session (manual)
The route against Postgres: pinned by `client-v2/api/account.test.mjs` under `yarn test-api`.
- **WHEN** `DELETE /api/account` arrives without a session cookie
- **THEN** the route answers `401` and deletes nothing

#### Scenario: A cross-site request (manual)
The route against Postgres: pinned by `client-v2/api/account.test.mjs` under `yarn test-api`.
- **WHEN** `DELETE /api/account` arrives with an `Origin` that is not one of the deployment's
- **THEN** the route answers `403` and deletes nothing

### Requirement: Deleting an account revokes the GitHub grant

After the transaction commits, the route SHALL ask GitHub to revoke the OAuth
grant the user's token belongs to. A revocation that fails SHALL be logged
with `report: true` and SHALL NOT change the `200`. The response body SHALL say
whether the grant was revoked: `{ "githubRevoked": true | false }`.

#### Scenario: GitHub revokes the grant (manual)
The route against Postgres: pinned by `client-v2/api/account.test.mjs` under `yarn test-api`.
- **WHEN** a user deletes their account and GitHub answers `204` to the revocation
- **THEN** the route answers `200` with `githubRevoked: true`

#### Scenario: GitHub is unreachable (manual)
The route against Postgres: pinned by `client-v2/api/account.test.mjs` under `yarn test-api`.
- **WHEN** a user deletes their account and the revocation request fails
- **THEN** the account is still deleted, the route reports `githubRevoked: false`, and the failure is reported

### Requirement: The account menu asks before deleting

The signed-in account menu SHALL hold a "Delete account" item (`aria-label`
"Delete account"). Picking it SHALL replace the items with the question
"Delete your Playground account?", the line "Your projects and chats saved to
the account are deleted, here and on every device. This cannot be undone.",
an "Export this project" link, a destructive "Delete account" button and a
Cancel that holds focus.

#### Scenario: Asking and cancelling (manual)
Pinned by `client-v2/src/widgets/session-footer/ui/SessionFooter.test.tsx`, under `yarn test-unit`.
- **WHEN** a signed-in person opens the account menu, picks Delete account, then Cancel
- **THEN** the question shows with focus on Cancel, then the menu's items return and nothing is deleted

### Requirement: A deleted account leaves the browser like a sign-out

When the server accepts the deletion, the browser SHALL end the session and run
the sign-out cleanup: projects and chats saved to the account leave this
browser, and projects never saved to it stay. The menu SHALL then say "Your
account was deleted." and, when `githubRevoked` is false, "Remove Playground
from your GitHub settings too.", linking `https://github.com/settings/applications`.

#### Scenario: Deleting from the menu
- **WHEN** a signed-in person with one synced and one never-synced project confirms Delete account and the server answers success
- **THEN** the account row reads "Sign in", the synced project is gone from the explorer, the never-synced project stays, and the menu says "Your account was deleted."

#### Scenario: Deletion refused
- **WHEN** the server answers the deletion with an error
- **THEN** the person stays signed in, every project stays, and the question says the account could not be deleted

### Requirement: The account menu counts how deletion ended

The session-footer slice SHALL emit `session_delete_account_ended` when the
delete question closes, with `outcome` `ok` or `cancelled`. A question closed by
closing the menu counts as `cancelled`. A failed deletion emits nothing; the
question stays open. `session_account_item_picked` SHALL accept the item
`delete-account`.

#### Scenario: Cancelling counts once (manual)
Pinned by `client-v2/src/widgets/session-footer/ui/SessionFooter.test.tsx`, under `yarn test-unit`.
- **WHEN** the person picks Delete account, then Cancel
- **THEN** `session_account_item_picked` with `item: "delete-account"` and one `session_delete_account_ended` with `outcome: "cancelled"` are sent
