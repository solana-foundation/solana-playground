# Spec Delta

## MODIFIED Requirements

### Requirement: The build server can require an API key

When `PG_API_KEYS` (a comma-separated list, one key per client) or
`PG_API_KEY` (one more key) is set, the build server SHALL answer `401` to
`/build`, `/deploy/<uuid>` and every `/unstable` route unless the request's
`x-api-key` header equals one of the keys, compared in constant time. No key
SHALL appear in the server's logs. When neither is set, the server SHALL
behave as before. The route SHALL send `PG_BUILD_SERVER_API_KEY` as
`x-api-key` when it is set, and a production deployment without it SHALL
report once per instance that the build server is open.

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

- **WHEN** one entry is removed from `PG_API_KEYS` and the server restarted
- **THEN** a request with that key gets `401` and the remaining keys still
  pass

#### Scenario: A server configured with the single key (manual)

- **WHEN** only `PG_API_KEY` is set
- **THEN** the server admits that key alone, as before this change

#### Scenario: The share routes stay open (manual)

- **WHEN** `PG_API_KEYS` is set and a request reaches `/share/<id>`
- **THEN** the server answers as before
