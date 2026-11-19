# build-server-access Specification

## Purpose

**Area:** Build-server access (client-v2 API)

Who may reach the Solana Foundation's build server, through which route, and
what is recorded about each build, so that the server is not open to anyone
who reads its URL.

## Requirements

### Requirement: Builds go through the deployment's own route

A deployment with sign-in SHALL point its client at `/api/build-server` on
the origin that served the client, by setting `REACT_APP_SERVER_URL` to that
path, and SHALL name the build server in `PG_BUILD_SERVER_URL`; no source file
names the build server's host. Without `PG_BUILD_SERVER_URL` the route SHALL
answer every request with `503` and call no server. The route SHALL forward
only `POST /build`, `GET /deploy/<uuid>`, `POST /unstable/build` and
`GET /unstable/deploy/<uuid>` to the configured build server, keeping the
build server's status and content type and the bytes of its answer, and SHALL
answer `404` to any other path or a deploy id that is not a UUID, `405` to
another method, `413` to a body over 1 MiB and `400` to a build body that is
not JSON. A build server that refuses the route itself (`401` or `403`) SHALL
be answered with `502` and reported, since it is a misconfiguration and not
the user's.

#### Scenario: A build is forwarded (manual)

- **WHEN** a signed-in user's browser posts a build request to
  `/api/build-server/build`
- **THEN** the build server receives the same body, and the browser receives
  the build server's status and JSON unchanged

#### Scenario: A path outside the build surface (manual)

- **WHEN** a request reaches `/api/build-server/share/abc`
- **THEN** the route answers `404` and calls no server

#### Scenario: A profile on the Solana Foundation option (manual)

- **WHEN** a profile on the "Solana Foundation" build server loads a client
  deployed with `REACT_APP_SERVER_URL=/api/build-server`
- **THEN** builds go to `/api/build-server` on the client's origin

#### Scenario: No build server configured (manual)

- **WHEN** a build reaches the route on a deployment without
  `PG_BUILD_SERVER_URL`
- **THEN** the route answers `503` and calls no server

### Requirement: Only a signed-in GitHub user builds

The route SHALL refuse a request without a GitHub session with `401` and the
JSON `{ "error": "Sign in with GitHub to build.", "reason": "signed-out" }`,
SHALL refuse a request from another site's origin with `403`, and SHALL answer
`503` when sign-in is not configured or the session cannot be read. A refused
request SHALL NOT reach the build server.

#### Scenario: Signed out

- **WHEN** a browser with no session presses Build on the default server
- **THEN** the route answers `401` with `reason: "signed-out"`, the Build
  stage shows "Sign in with GitHub to build" with one "Sign in with GitHub"
  button, the stage and the status bar read "Sign in to build" with no failed
  build, the terminal prints "Sign in with GitHub to build." as a plain line,
  and the build server sees no request

#### Scenario: Signed in after the refusal (manual)

- **WHEN** the user signs in from that button
- **THEN** the build runs again by itself

### Requirement: Every build is recorded

The route SHALL write one `build_audit` row per forwarded build before the
build server is called, holding the user id, the GitHub account id, the
GitHub login when the user has one stored, the time, the
project id and name the client sent, whether the route was unstable and the
request size; and SHALL complete it with the program UUID (the server's, else
the request's, and only a UUID), the status and the duration once the build
ends. The status is the build server's, or `499` when the caller left first
and `502` when the server could not be reached, cut its answer off or refused
the route. A deploy download needs the same sign-in and is not recorded. When the row cannot be written,
the route SHALL answer `503` and not call the build server.

#### Scenario: A build on record (manual)

- **WHEN** a signed-in user builds project "hello-anchor"
- **THEN** one row names that user and their GitHub account id, the project,
  the program UUID, status `200` and the duration

#### Scenario: The database is down (manual)

- **WHEN** the audit row cannot be written
- **THEN** the route answers `503` and the build server sees no request

### Requirement: The build server can require an API key

When `PG_API_KEYS` (comma-separated, one key per client) or `PG_API_KEY` is
set, the build server SHALL answer `401` to `/build`, `/deploy/<uuid>` and
every `/unstable` route unless `x-api-key` equals one of the keys, compared in
constant time. No key SHALL appear in its logs. With neither set, it SHALL
behave as before. The route SHALL send `PG_BUILD_SERVER_API_KEY` as
`x-api-key` when set; a production deployment without it SHALL report once
per instance that the build server is open.

#### Scenario: A direct request to a keyed server (manual)

- **WHEN** `PG_API_KEYS` is set and `curl` posts to the server's `/build`
  without the header, or with a key outside the list
- **THEN** the server answers `401` and starts no build

#### Scenario: The route's request (manual)

- **WHEN** the route forwards a build with its key, one entry of the list
- **THEN** the server builds as before

#### Scenario: Another client's key (manual)

- **WHEN** a request to `/build` carries any other entry of `PG_API_KEYS`
- **THEN** it reaches the build as the route's request does

#### Scenario: A removed key (manual)

- **WHEN** one entry is removed from `PG_API_KEYS` and the server redeployed
- **THEN** a request with that key gets `401` and the remaining keys still
  pass

#### Scenario: A server configured with the single key (manual)

- **WHEN** only `PG_API_KEY` is set
- **THEN** the server admits that key alone, as before this change

#### Scenario: Both variables set (manual)

- **WHEN** `PG_API_KEYS` holds a key and `PG_API_KEY` is set too
- **THEN** only the list's keys pass; the value of `PG_API_KEY` gets `401`
  unless it is also an entry of the list

#### Scenario: A key variable set without a key (manual)

- **WHEN** `PG_API_KEYS` or `PG_API_KEY` is set but holds no key, or a key with
  a space or a character outside visible ASCII
- **THEN** the server stops at start with an error that names the variable and
  no key, rather than leaving the routes open
