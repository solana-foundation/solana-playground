# Spec Delta

## Purpose

Tells the client, for the person asking, whether an AI key is available on this
deployment and whose it is, so AI surfaces appear only when they can work.

## ADDED Requirements

### Requirement: The status route reports key availability per caller

`GET /api/ai/status` SHALL answer `200` with a JSON body holding `available`
(boolean), `key` (`"hosted"` or `"own"`), `reason` (`"signed-out"`,
`"unavailable"` or `null`) and `model` (a string or `null`). `key` is
`"hosted"` only when the deployment has a hosted key and sign-in configured,
and `model` is then the hosted model's id; otherwise `key` is `"own"`, `model`
is `null`, and the user supplies a key in settings. `available` speaks for the
hosted key only: `key` is what the deployment offers and says nothing about a
key the user has, and `available` means a hosted key and sign-in are present,
not that the model answers. `reason` is non-null exactly when `key` is
`"hosted"` and `available` is `false`.

#### Scenario: No key configured

- **WHEN** the deployment has no hosted key, or has one but sign-in is not configured
- **THEN** the route answers `{ "available": false, "key": "own", "reason": null, "model": null }`, and a deployment with a key but incomplete sign-in settings logs the missing settings' names

#### Scenario: Signed out with the hosted key

- **WHEN** the deployment has a hosted key and sign-in, and the caller has no session
- **THEN** the route answers `available: false`, `key: "hosted"`, `reason: "signed-out"` and the hosted model's id

#### Scenario: Signed in with the hosted key

- **WHEN** the deployment has a hosted key and sign-in, and the caller is signed in
- **THEN** the route answers `available: true`, `key: "hosted"`, `reason: null` and the hosted model's id

#### Scenario: The session lookup fails

- **WHEN** the deployment has a hosted key and sign-in, and reading the caller's session fails
- **THEN** the route answers `available: false`, `key: "hosted"`, `reason: "unavailable"` and the hosted model's id

#### Scenario: Sign-in reads as unconfigured at lookup

- **WHEN** the deployment's hosted key and sign-in settings are present, but reading the session reports sign-in as unconfigured
- **THEN** the route answers `{ "available": false, "key": "own", "reason": null, "model": null }` and logs a warning

### Requirement: The status answer never discloses the key

The status route's body and headers SHALL NOT contain the hosted key, the
newcomer key, or any substring of either, and the answer SHALL carry
`Cache-Control: no-store` because it depends on the caller's session.

#### Scenario: A configured key stays on the server

- **WHEN** the deployment has a hosted key, and the caller is signed in, signed out, or their session lookup fails, or sends a `POST`
- **THEN** no part of either key appears in the response, and `Cache-Control` is `no-store`

### Requirement: The status route is read-only

The status route SHALL serve `GET` and `HEAD` only and answer any other method
with `405` and an `Allow: GET, HEAD` header.

#### Scenario: A POST is refused

- **WHEN** a client sends `POST /api/ai/status`
- **THEN** the route answers `405` with `Allow: GET, HEAD` and a body `{ "error": string }`, which is not a status answer

### Requirement: The deployed path reaches the status route

`/api/ai/status` SHALL be served by a function on the deployment, not by the
single-page fallback.

#### Scenario: The platform's routing serves the path

- **WHEN** the deployment's routing rules are applied to `/api/ai/status`
- **THEN** a function answers it, as the routing test over `vercel.json` checks
