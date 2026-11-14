# Spec Delta

## ADDED Requirements

### Requirement: Transactions carry no secret key

A transaction and each span the browser sends to Sentry SHALL be scrubbed by the
rules that "Reports carry no user code or secret key" sets for an error event:
every value in a URL, a span description, a tag or an attribute that matches
one of those patterns SHALL arrive as `[redacted]`, and a transaction that
cannot be scrubbed SHALL NOT be sent.

#### Scenario: A secret key in the page URL (manual)

- **WHEN** a traced page loads with a 64-byte secret key in base58 in its query
  string
- **THEN** the `pageload` transaction in Sentry shows `[redacted]` in its place,
  in the transaction name, the URL tag and every span

#### Scenario: A secret key in a request URL

- **WHEN** a traced page sends a same-origin request whose URL holds a 64-byte
  secret key in hex
- **THEN** the span for that request shows `[redacted]` in its description and
  its URL attribute

#### Scenario: A transaction that cannot be scrubbed

- **WHEN** scrubbing a transaction throws
- **THEN** the transaction is dropped, and no span of it reaches Sentry
