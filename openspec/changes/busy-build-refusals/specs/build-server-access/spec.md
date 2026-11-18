# Spec Delta

## ADDED Requirements

### Requirement: A user's builds are limited

The route SHALL let each signed-in GitHub user have at most one build running
and at most 20 builds in the last hour, counted from that user's audit rows.
A row still without a status SHALL count as running only within the route's
`maxDuration`. A build over either limit SHALL be answered `429` with
`Retry-After` in seconds and the JSON `{ error, reason: "build-limit" }`, and
SHALL NOT reach the build server. When the count cannot be read, the route
SHALL answer `503`.

#### Scenario: A second build while the first runs (manual)

- **WHEN** a signed-in user starts a build while their previous build is
  still running
- **THEN** the route answers `429` with `reason: "build-limit"` and a
  `Retry-After` of at most 15 seconds, and the build server sees no request

#### Scenario: Past the hourly limit (manual)

- **WHEN** a signed-in user who started 20 builds in the last hour starts
  another
- **THEN** the route answers `429` with `Retry-After` set to the seconds until
  their oldest build in that hour leaves it

#### Scenario: A build whose function died (manual)

- **WHEN** a user's previous build row has no status and is older than the
  route's `maxDuration`
- **THEN** that row does not count as running, and the user's next build is
  forwarded

#### Scenario: A user under both limits (manual)

- **WHEN** a signed-in user with no build running and fewer than 20 builds in
  the last hour starts a build
- **THEN** the build is forwarded and recorded as before

#### Scenario: The count cannot be read (manual)

- **WHEN** the database does not answer the count
- **THEN** the route answers `503` and the build server sees no request

### Requirement: The Build stage shows a busy refusal as a wait

A build answered `429` or `503` with `Retry-After` SHALL NOT be shown as a
failed build. The Build stage SHALL title it "Builds are busy, retry in N s",
counting N down each second to "Builds are busy, try again now", SHALL show
the answer's words, and SHALL carry one "Try again" button. The stage SHALL
keep its last settled state, and the terminal SHALL print the refusal as a
plain line. A `503` without `Retry-After` SHALL stay an ordinary failure.

#### Scenario: A build turned away as busy (manual)

- **WHEN** the route answers a build with `429` and `Retry-After: 15`
- **THEN** the Build stage reads "Builds are busy, retry in 15 s" with the
  answer's words and one "Try again" button, the status bar reads "Build busy ·
  retry in 15 s", and no failed build is shown

#### Scenario: The wait runs out (manual)

- **WHEN** the Build stage has shown a busy refusal for the seconds it named
- **THEN** its title reads "Builds are busy, try again now", and "Try again"
  runs the build again

#### Scenario: A busy refusal does not stand in for a failed build (manual)

- **WHEN** a build of changed code is turned away as busy, and the user
  presses Deploy
- **THEN** Deploy does not ship the binary of the previous build

## MODIFIED Requirements

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
the user's. The route SHALL keep the build server's `Retry-After` on a `429`
or `503` answer and drop it on any other status, and SHALL NOT report a `503`
that carries `Retry-After` as a server error, since it means the build
server's queue is full.

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

#### Scenario: The build server's queue is full (manual)

- **WHEN** the build server answers a build with `503` and `Retry-After: 30`
- **THEN** the browser receives `503` with `Retry-After: 30`, the route
  records `503` on the build's audit row, and no server error is reported

#### Scenario: A Retry-After on another status (manual)

- **WHEN** the build server answers a build with `500` and a `Retry-After`
- **THEN** the browser receives `500` without `Retry-After`, and the error is
  reported

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
the route SHALL answer `503` and not call the build server. A build refused
by a build limit is not forwarded and SHALL NOT write a row.

#### Scenario: A build on record (manual)

- **WHEN** a signed-in user builds project "hello-anchor"
- **THEN** one row names that user and their GitHub account id, the project,
  the program UUID, status `200` and the duration

#### Scenario: The database is down (manual)

- **WHEN** the audit row cannot be written
- **THEN** the route answers `503` and the build server sees no request

#### Scenario: A build refused by a limit (manual)

- **WHEN** the route answers a build `429` with `reason: "build-limit"`
- **THEN** no `build_audit` row is written for that build
