# build-server Specification

## Purpose

States which HTTP routes the Rust server in `server/` serves and what it needs to start, so the fork's build
backend stays a build service with no storage of its own.

## Requirements

### Requirement: The server serves no share routes

The server SHALL answer `GET /share/{id}` and `POST /new` with 404, in a build with or without the `unstable`
feature. It SHALL offer no route that stores a project for others to open; the files a build writes are not
covered by this requirement.

#### Scenario: A share lookup is not found (manual)

- **WHEN** a running server receives `GET /share/6539a1c2f1e4b8a9d0c3e7f2`
- **THEN** it answers 404

#### Scenario: A new share is not found (manual)

- **WHEN** a running server receives `POST /new` with the body `{"explorer":{"files":{}}}` and
  `Content-Type: application/json`
- **THEN** it answers 404

### Requirement: The server starts without a database

The server SHALL start and serve `/build` with no database reachable and no database setting in its environment.
It SHALL NOT read `PG_DB_URI` or `PG_DB_NAME`.

#### Scenario: Start with no database (manual)

- **WHEN** the server starts with neither `PG_DB_URI` nor `PG_DB_NAME` set and no MongoDB on the network
- **THEN** it logs that it listens on its port, and `POST /build` with an Anchor starter program returns 200

### Requirement: The server bounds the wait for a build slot

A build request that finds no free slot SHALL wait in a queue of at most
`PG_BUILD_QUEUE_LIMIT` requests (default 6), each for at most
`PG_BUILD_QUEUE_WAIT_SECS` seconds (default 60). A request past either bound
SHALL be answered `503` with `Retry-After` in seconds, SHALL take no slot,
and SHALL leave no place held in the queue. The wait and the build together
SHALL stay within the request's time limit, which ends before the
`maxDuration` of `/api/build-server`.

#### Scenario: A free slot (manual)

- **WHEN** a build request arrives while a slot is free
- **THEN** the build starts at once, as before

#### Scenario: The queue is full (manual)

- **WHEN** every slot is taken and `PG_BUILD_QUEUE_LIMIT` requests are
  already waiting, and another build request arrives
- **THEN** the server answers it `503` with `Retry-After` at once

#### Scenario: The wait runs out (manual)

- **WHEN** a waiting request gets no slot within `PG_BUILD_QUEUE_WAIT_SECS`
- **THEN** the server answers it `503` with `Retry-After`, and no slot is
  used for it

#### Scenario: A caller that leaves while waiting (manual)

- **WHEN** a request leaves the queue before it gets a slot
- **THEN** its place in the queue is free for the next request
