# Spec Delta

## Purpose

What `features/auth` reports about sign-in and sign-out, so the share of
sign-ins that fail, and the step they fail at, can be measured.

## ADDED Requirements

### Requirement: Sign-in and sign-out are tracked

`features/auth` SHALL track these events and no parameters beyond those
listed:

- `auth_sign_in_started`: the user asked to sign in with GitHub, before the
  popup opens. No parameters.
- `auth_signed_in`: the popup reported success and the session was re-read.
  No parameters.
- `auth_sign_in_failed`: the sign-in ended without a session. `reason`, one
  of `request-failed` (the sign-in request failed, returned no authorize
  URL, or any other step failed without a reason of its own), `popup-blocked` (the browser blocked the popup), `cancelled` (the
  user closed the popup), `rejected` (a reply arrived that did not match this
  sign-in), `expired` (no reply arrived in time).
- `auth_signed_out`: the user signed out. No parameters.

#### Scenario: A completed sign-in

- **WHEN** the popup reports success
- **THEN** `auth_sign_in_started` and then `auth_signed_in` are tracked

#### Scenario: A blocked popup

- **WHEN** the browser blocks the sign-in popup
- **THEN** `auth_sign_in_started` and then `auth_sign_in_failed` with reason
  `popup-blocked` are tracked

#### Scenario: The sign-in request does not reach the server

- **WHEN** the request that starts the sign-in rejects
- **THEN** `auth_sign_in_failed` with reason `request-failed` is tracked, and
  the error still reaches the caller

#### Scenario: A sign-out

- **WHEN** the user signs out
- **THEN** `auth_signed_out` is tracked, also when the sign-out request fails
