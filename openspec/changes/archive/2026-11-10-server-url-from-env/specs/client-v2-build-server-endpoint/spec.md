# Spec Delta

## Purpose

Where `client-v2` takes its build server URL from, what the "Build server" setting offers, and what a deployment
build or a development server does when the URL is not configured.

## ADDED Requirements

### Requirement: No source file names the production build server

The production build server's URL SHALL come only from `REACT_APP_SERVER_URL`. No tracked file outside `client/`
SHALL contain the production build server's host.

#### Scenario: The sources are searched (manual)

- **WHEN** a reviewer runs `git grep -n appspot -- ':!client/'`
- **THEN** it prints nothing

### Requirement: A deployment build needs the URL

A build with `VERCEL_ENV` set SHALL fail before bundling when `REACT_APP_SERVER_URL` is empty or unset, with a
message that names `REACT_APP_SERVER_URL`. A build without `VERCEL_ENV` SHALL NOT fail for this reason.

#### Scenario: A preview build without the variable

- **WHEN** the build runs with `VERCEL_ENV=preview` and no `REACT_APP_SERVER_URL`
- **THEN** it exits non-zero, and its output names `REACT_APP_SERVER_URL`

#### Scenario: A CI build

- **WHEN** the build runs with neither `VERCEL_ENV` nor `REACT_APP_SERVER_URL`
- **THEN** the check passes

### Requirement: Development defaults to a local server

When `REACT_APP_SERVER_URL` is empty, the default build server SHALL be `http://localhost:8080`, and the client SHALL
log a warning that names `REACT_APP_SERVER_URL` once at start-up.

#### Scenario: A fresh checkout

- **WHEN** `yarn dev` runs without `REACT_APP_SERVER_URL` and a fresh profile opens the app
- **THEN** the "Build server" setting is `http://localhost:8080`, and the console shows the warning

### Requirement: The Foundation option follows the variable

The "Build server" setting SHALL list "Solana Foundation" with the URL from `REACT_APP_SERVER_URL` when the variable
is set, and SHALL NOT list it when the variable is empty. A profile that stored that option SHALL use the variable's
current URL, or the default when the variable is empty.

#### Scenario: The variable is set

- **WHEN** `REACT_APP_SERVER_URL` is `https://server.example`
- **THEN** the setting lists "Solana Foundation" with `https://server.example`, before "Local"

#### Scenario: A stored choice without the variable

- **WHEN** a profile stored the "Solana Foundation" option and the app starts with `REACT_APP_SERVER_URL` empty
- **THEN** the setting is `http://localhost:8080`
