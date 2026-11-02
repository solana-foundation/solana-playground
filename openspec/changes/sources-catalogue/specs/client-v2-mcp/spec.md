# Spec Delta

## ADDED Requirements

### Requirement: Switching a server is reported

The event `mcp_server_toggled` SHALL fire each time a user checks or unchecks a server in the Sources tab, with
`server`: `gateway` for a server reached through `/api/mcp`, `user` for one the user added; and `enabled`:
`true` when the server was switched on, `false` when off. The event SHALL NOT carry the server's id, name, or
URL.

#### Scenario: A gateway server unchecked (manual)

- **WHEN** the user unchecks the gateway server `solana`
- **THEN** `mcp_server_toggled` fires once with `server: "gateway"` and `enabled: false`

### Requirement: The gateway sends an entry's credentials

An entry's credentials are its `headers`, its `queryParams`, its `authToken`, and its `protection` secret. For
a caller signed in on this site, the gateway SHALL send them on each request to the upstream: `headers` as
headers, `queryParams` as query parameters of the upstream URL, `authToken` as a bearer `authorization` header,
and the `protection` secret in the header its provider names. Each field SHALL mean what the browser client
makes it mean for a user entry. For any other caller, the gateway SHALL send none of them. The gateway SHALL
NOT send any of them to the browser.

#### Scenario: An upstream with a query credential (manual)

- **WHEN** the catalogue in effect holds a server with `queryParams: { "key": "${UPSTREAM_KEY}" }` and the
  variable is set, and a user signed in on this site lists its tools through the gateway
- **THEN** the gateway's request to the upstream carries `?key=<value>`, and `GET /api/mcp` lists the server
  with its id and name only

#### Scenario: The same upstream for a signed-out caller (manual)

- **WHEN** the same server is in the catalogue and a signed-out user lists its tools through the gateway
- **THEN** the gateway's request to the upstream carries no `key` query parameter
