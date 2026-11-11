# Spec Delta

## Purpose

States which HTTP routes the Rust server in `server/` serves and what it needs to start, so the fork's build
backend stays a build service with no storage of its own.

## ADDED Requirements

### Requirement: The server serves no share routes

The server SHALL answer `GET /share/{id}` and `POST /new` with 404, in a build with or without the `unstable`
feature. It SHALL store no project files that a client sends it.

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
