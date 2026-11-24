# Spec Delta

## ADDED Requirements

### Requirement: The stored GitHub token is encrypted at rest

The server SHALL store each user's GitHub access token encrypted with
`AUTH_SECRET`, a key that lives in the deployment's environment and never in
the database, so a row read directly from the database holds no usable
token. No route SHALL read the token with SQL: routes read it only through
the auth library that decrypts it. A token stored before encryption and not
yet encrypted SHALL still be read as it is.

#### Scenario: A row read directly holds no token (manual)

- **WHEN** a user signs in with GitHub and the `account` row is read with SQL
- **THEN** `"accessToken"` holds ciphertext, not the token GitHub issued, and
  reading it through the auth library returns the token
- Pinned by client-v2/src/features/auth/model/auth.test.mjs: "stores the
  tokens sign-in writes encrypted", and by
  client-v2/src/features/auth/model/github-token.test.mjs: "reads the
  encrypted token stored for the user's GitHub account"

#### Scenario: A token stored before encryption (manual)

- **WHEN** a row still holds the plaintext token written before encryption
- **THEN** the token is read and used as it is
- Pinned by client-v2/src/features/auth/model/github-token.test.mjs: "reads
  a token stored before encryption as it is"

#### Scenario: Encrypting the rows written before encryption (manual)

- **WHEN** the encryption script runs against a database with plaintext rows
  and is confirmed
- **THEN** every plaintext token is encrypted with `AUTH_SECRET`, a row a
  sign-in rewrote meanwhile is left as written, and a second run finds no
  plaintext row
- Pinned by client-v2/scripts/db/encrypt-github-tokens.test.mjs

### Requirement: A token that no longer decrypts is a missing grant

A stored GitHub token that does not decrypt under the current `AUTH_SECRET`
SHALL read as a missing grant, never as a server failure: `POST /api/gists`
SHALL answer `401 {reason: "github-unauthorized"}`, and the user's next
sign-in SHALL store a fresh token that the route then uses. The route SHALL
report the failure, since a changed secret makes every encrypted token
unreadable at once.

#### Scenario: After AUTH_SECRET changes (manual)

- **WHEN** the token was stored under an `AUTH_SECRET` since replaced
- **THEN** reading it fails as a missing grant, and `POST /api/gists`
  answers `401` with reason `github-unauthorized` and reports the failure
- Pinned by client-v2/src/features/auth/model/github-token.test.mjs: "throws
  NoGithubGrant for a token stored under another secret", and by
  client-v2/api/gists.test.mjs: "401s github-unauthorized for a token that no
  longer decrypts, and reports it"
