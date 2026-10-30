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

For each request to an upstream, the gateway SHALL send the entry's `headers`, its `queryParams` as query
parameters of the upstream URL, its `authToken` as a bearer `authorization` header, and its `protection` secret
in the header its provider names, each with the meaning the browser client gives the field for a user entry.
The `protection` secret SHALL go only on requests from a caller signed in on this site. The gateway SHALL NOT
send any of them to the browser.

#### Scenario: An upstream with a query credential (manual)

- **WHEN** the catalogue in effect holds a server with `queryParams: { "key": "${UPSTREAM_KEY}" }` and the
  variable is set, and a user lists its tools through the gateway
- **THEN** the gateway's request to the upstream carries `?key=<value>`, and `GET /api/mcp` lists the server
  with its id and name only
