# Spec Delta

## Purpose

Defines what `@/shared/lib/ai` guarantees to any caller that talks to a model
through it: how a turn runs and stops, how failures surface, how MCP servers
are reached, and where a connection's key may appear.

## ADDED Requirements

### Requirement: A turn stops at its step limit

A turn SHALL send no model request after it reaches the caller's step limit,
or the module's private fallback when the caller sets none, even when the
last step asked for more tool calls. The module SHALL NOT export the
fallback: each caller passes its own limit from its `config.ts`. Resumes of a
paused turn are counted by their own limit, not by the step limit.

#### Scenario: A model that keeps calling tools (manual)

- **WHEN** a fake model answers every request with a tool call and the step
  limit is 3
- **THEN** the turn sends exactly 3 model requests and ends

### Requirement: A paused turn is resumed, up to a limit

When a step ends because the provider paused the turn (Anthropic's
`pause_turn`), the module SHALL send the paused content back and continue the
turn, and SHALL stop with an `AiTurnError` once the turn has paused more times
than the caller's resume limit, or the module's private fallback when the
caller sets none. The module SHALL NOT export the fallback: each caller
passes its own limit from its `config.ts`.

#### Scenario: A paused turn is resumed

- **WHEN** the provider's first response ends with `pause_turn` and its second
  ends normally
- **THEN** the module sends a second request whose history ends with the
  paused assistant content, the text of both responses reaches the caller's
  text callback, and the turn resolves

#### Scenario: A turn that keeps pausing

- **WHEN** every response ends with `pause_turn`
- **THEN** the module sends one request more than the resume limit and the
  turn rejects with an `AiTurnError` that says the turn kept pausing

### Requirement: A failed request is not retried

The module SHALL send each model request once. A failed request, whatever its
status, SHALL fail the turn without a second attempt, so a server-side cap
that answers 429 is reached once per turn.

#### Scenario: A 429 from the provider (manual)

- **WHEN** the provider answers the first request with status 429
- **THEN** exactly one request was sent and the turn rejects

### Requirement: Abort ends the turn

A turn SHALL observe the caller's abort signal: on abort it SHALL stop
reading the response, reject with the abort reason, and send no further
request, including the request that would follow a tool call or a pause.

#### Scenario: Abort mid-stream (manual)

- **WHEN** the caller aborts while the first response is still streaming text
- **THEN** the turn rejects with the abort reason and no second request is
  sent

### Requirement: Provider failures surface as AiTurnError

An error the provider reports inside a stream, and a refusal by the model,
SHALL each make the turn reject with an `AiTurnError` whose message carries
the provider's own message (for a refusal, its category when the provider
gives one). A turn SHALL NOT resolve as if it had finished when either
happened.

#### Scenario: An error frame mid-stream (manual)

- **WHEN** the stream delivers some text, then an error frame whose message is
  "overloaded", cut across two chunks
- **THEN** the turn rejects with an `AiTurnError` whose message contains
  "overloaded"

#### Scenario: A refusal (manual)

- **WHEN** the provider ends the response with a refusal of category "cyber"
- **THEN** the turn rejects with an `AiTurnError` whose message contains
  "cyber"

### Requirement: A tool awaiting approval holds the turn

The module SHALL send the request that follows a tool call only after that
tool's execution resolves, so a tool that waits for the user's approval holds
the whole turn until the user answers.

#### Scenario: A tool waiting for approval (manual)

- **WHEN** the model calls a tool whose execution waits on an unresolved
  promise
- **THEN** no second request is sent until the promise resolves, and the
  second request carries the tool's result

### Requirement: A tool schema reaches the model as JSON Schema

A tool SHALL be declared with either a plain JSON Schema or a zod schema, and
in both cases the model SHALL receive the tool's parameters as JSON Schema.

#### Scenario: A tool with a zod schema (manual)

- **WHEN** a tool declared with a zod object schema of one required string
  field `path` is offered to the model
- **THEN** the request's tool parameters are a JSON Schema object whose
  `required` lists `path` and whose `path` property has type `string`

### Requirement: MCP servers reconnect and report unreachable hosts

An MCP connection SHALL open a new session and repeat the call once when the
server rejects the session as expired, and SHALL raise
`McpUnreachableError` when the browser cannot reach the host (a CORS refusal
or a network failure), so a caller can tell an unreachable host from a server
that answered with an error.

#### Scenario: A stale MCP session (manual)

- **WHEN** a tool call is answered with the server's "session not found"
  response (HTTP 404 on a request that carried a session id)
- **THEN** the connection initialises a new session and the call returns the
  result of the repeated request

#### Scenario: A host that refuses the browser (manual)

- **WHEN** `fetch` rejects with a `TypeError` while listing a server's tools
- **THEN** the call rejects with `McpUnreachableError`

### Requirement: Each provider is reached at its endpoint with its auth header

A connection SHALL be sent to the endpoint its provider uses, with the key in
the header that provider expects: `x-api-key` and the browser-access header
for Anthropic, `Authorization: Bearer` for the OpenAI-compatible providers
(OpenAI, Gemini, OpenRouter, a custom base URL). An OpenAI-compatible
connection with an empty key SHALL send no `Authorization` header.

#### Scenario: Each provider's endpoint and auth header (manual)

- **WHEN** a turn runs for each provider id with a test key
- **THEN** each request goes to that provider's endpoint and carries the key
  only in that provider's auth header

### Requirement: The default backend goes through /api/agent

A connection to the default backend SHALL send every model request to the
same-origin route its caller passes, in the chat-completions format, with no
key. The assistant passes `/api/agent`, `DEFAULT_BACKEND_URL` in its
`config.ts`; the module's private fallback is the same route.

#### Scenario: A turn on the default backend (manual)

- **WHEN** a turn runs on the default backend and calls one tool
- **THEN** both requests go to `/api/agent` and neither carries an
  `Authorization` or `x-api-key` header

### Requirement: Error text never carries the key

Any error the module raises, and any message it hands to a callback, SHALL
replace the connection's key with `REDACTED_KEY` wherever the provider's text
quotes it, for a key of at least `MIN_REDACTED_KEY_LENGTH` characters.

#### Scenario: A provider error that quotes the key (manual)

- **WHEN** the provider answers 401 with a body that contains the key
- **THEN** the rejected error's message and its `body` contain
  `REDACTED_KEY` and not the key
