# Spec Delta

## ADDED Requirements

### Requirement: Transactions carry no secret key

A transaction and each span the browser sends to Sentry SHALL be scrubbed by the
rules that "Reports carry no user code or secret key" sets for an error event,
its breadcrumbs included: each value in a URL, span description, tag or
attribute that matches those patterns SHALL arrive as `[redacted]`. A
transaction whose scrub throws SHALL NOT be sent, and one message per session
SHALL say so; one whose root span alone fails SHALL be sent marked, with its
Web Vitals.

#### Scenario: A secret key in the page URL (manual)

- **WHEN** a traced page loads with a 64-byte secret key in base58 in its query
  string
- **THEN** the `pageload` transaction in Sentry shows `[redacted]` in its place,
  in the transaction name, the URL tag and every span

#### Scenario: A secret key in a request URL (manual)

- **WHEN** a traced page sends a same-origin request whose URL holds a 64-byte
  secret key
- **THEN** the span for that request shows `[redacted]` in its description and
  its URL attribute

#### Scenario: A transaction that cannot be scrubbed (manual)

- **WHEN** scrubbing a transaction throws, twice in one session
- **THEN** neither transaction nor any span of it reaches Sentry
- **AND** Issues lists one "Transaction withheld: scrubbing it failed" message,
  tagged `scrub_error` with the failure's name

#### Scenario: A root span that cannot be scrubbed (manual)

- **WHEN** scrubbing a page load's root span throws, and the rest of the
  transaction scrubs
- **THEN** the `pageload` transaction reaches Sentry with its Web Vitals
  measurements, its trace data marked `scrub.withheld`, and no secret

### Requirement: URLs in reports carry no credentials

In every URL the browser sends to Sentry, comma-joined URLs each on their own,
and in a span's `url.query`, `url.fragment`, `server.address` and
`url.domain`, credentials, each token-like run in a host label, path segment,
query value or fragment, and a key-named query value SHALL be `[redacted]`, by
the rule that masks a saved RPC's URL. The rest SHALL stay as the URL
parser reads it, a port and a hashed file name under `static/` whose name is
not token-like, with its `:line:col`, included.

#### Scenario: A provider key in the path (manual)

- **WHEN** a traced page load sends RPC requests to a custom endpoint
  `https://solana-mainnet.g.alchemy.com/v2/abc123def456ghi789`
- **THEN** each request span shows `https://solana-mainnet.g.alchemy.com/v2/[redacted]`

#### Scenario: A provider key in the query (manual)

- **WHEN** a reported error carries a fetch breadcrumb for
  `https://devnet.helius-rpc.com/?api-key=abc`
- **THEN** the breadcrumb shows `https://devnet.helius-rpc.com/?api-key=[redacted]`

#### Scenario: The app's own bundle in a stack frame (manual)

- **WHEN** a production build reports an error thrown in
  `https://playground.solana.com/static/js/main.<hash>.js`
- **THEN** the event's stack frames show that URL unchanged and resolve against
  the uploaded source maps

#### Scenario: A provider key in the host (manual)

- **WHEN** a traced page load sends a request to
  `https://acme-mainnet-4f2a9c1b7d3e.rpc.example.test/`
- **THEN** the request span shows `[redacted].rpc.example.test` in its URL, its
  server address and its domain

#### Scenario: A URL with nothing secret in it (manual)

- **WHEN** a span's URL is `https://api.devnet.solana.com/`
- **THEN** the span shows the URL unchanged
