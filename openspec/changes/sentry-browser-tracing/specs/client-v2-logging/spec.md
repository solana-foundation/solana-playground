# Spec Delta

## ADDED Requirements

### Requirement: Transactions carry no secret key

A transaction and each span the browser sends to Sentry SHALL be scrubbed by the
rules that "Reports carry no user code or secret key" sets for an error event,
its breadcrumbs included: every value in a URL, a span description, a tag or an
attribute that matches one of those patterns SHALL arrive as `[redacted]`, and a
transaction that cannot be scrubbed SHALL NOT be sent.

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

- **WHEN** scrubbing a transaction throws
- **THEN** the transaction is dropped, and no span of it reaches Sentry

### Requirement: URLs in reports carry no credentials

In every URL inside an error event, a breadcrumb, a transaction or a span the
browser sends to Sentry, a user name or password, a token-like host label, path
segment or fragment, and the value of a secret query term SHALL be replaced
with `[redacted]`, by the rule that masks a custom RPC URL on screen. The rest
of the URL SHALL stay, so the provider and the route remain readable.

#### Scenario: A provider key in the path (manual)

- **WHEN** a traced page load sends RPC requests to a custom endpoint
  `https://solana-mainnet.g.alchemy.com/v2/abc123def456ghi789`
- **THEN** each request span shows `https://solana-mainnet.g.alchemy.com/v2/[redacted]`

#### Scenario: A provider key in the query (manual)

- **WHEN** a reported error carries a fetch breadcrumb for
  `https://devnet.helius-rpc.com/?api-key=abc`
- **THEN** the breadcrumb shows `https://devnet.helius-rpc.com/?api-key=[redacted]`

#### Scenario: A URL with nothing secret in it (manual)

- **WHEN** a span's URL is `https://api.devnet.solana.com/`
- **THEN** the span shows the URL unchanged
