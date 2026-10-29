# Spec Delta

## Purpose

Bounds what the default assistant backend (`/api/agent`) spends on the
deployment's model key: per signed-in user per day, per request, and per
account tier, and defines what the caller and the panel see when a limit is
reached.

## ADDED Requirements

### Requirement: A user's daily spend is capped

`POST /api/agent` SHALL refuse a turn from a signed-in user whose spend for the
current UTC day, plus the worst-case cost of that turn, would exceed the daily
cap of the user's tier. The refusal SHALL be a 429 with
`{ "reason": "daily-cap", "tier": <tier> }` and a `Retry-After` header counting the seconds to
the next 00:00 UTC, sent before the body is forwarded and before the upstream
is called. Spend counts from zero again at 00:00 UTC.

#### Scenario: A turn past the cap is refused without an upstream call

- **WHEN** a signed-in user whose recorded spend today equals their tier's
  daily cap sends a turn
- **THEN** the response is 429 with `reason` `daily-cap` and a `Retry-After`
  header, and the upstream `fetch` is not called

#### Scenario: The cap resets at 00:00 UTC

- **WHEN** a user who was refused with `daily-cap` before 00:00 UTC sends a
  turn after 00:00 UTC
- **THEN** the turn is forwarded to the upstream

#### Scenario: Users do not share a cap

- **WHEN** one user has reached the daily cap and another user of the same
  tier with no spend today sends a turn
- **THEN** the second user's turn is forwarded to the upstream

### Requirement: Concurrent turns cannot pass the cap together

Before calling the upstream, `POST /api/agent` SHALL reserve the turn's
worst-case cost against the user's daily spend, and SHALL admit the turn only
when the reservation keeps the user within the cap. Turns sent at the same time
by one user SHALL together never reserve more than the cap.

#### Scenario: Parallel turns at the edge of the cap

- **WHEN** a user whose remaining allowance covers the worst-case cost of
  exactly one turn sends two turns at the same time
- **THEN** one turn is forwarded to the upstream and the other is refused with
  429 and `reason` `daily-cap`

### Requirement: A turn is charged what it cost

When a turn ends, `POST /api/agent` SHALL replace the turn's reservation with
its charge: the cost of the token usage the upstream reported for a turn that
streamed to the end with the caller still connected, the full reservation for
any other turn the upstream may have received (the caller went away, before
the upstream answered or while the turn streamed; the stream broke; no usage
was reported), and nothing for a turn the upstream refused before streaming.

#### Scenario: A completed turn is charged its reported usage

- **WHEN** a turn streams to the end and the upstream reports its token usage
- **THEN** the user's spend today grows by the cost of that usage, not by the
  reservation

#### Scenario: A turn the caller abandons is charged the reservation

- **WHEN** the caller closes the connection while the turn is streaming
- **THEN** the user's spend today grows by the full reservation, even when the
  upstream reported usage before the caller left

#### Scenario: A turn the caller abandons before the upstream answers is charged the reservation

- **WHEN** the caller closes the connection after the upstream request is sent
  and before the upstream answers
- **THEN** the user's spend today grows by the full reservation

#### Scenario: A turn the upstream refuses is not charged

- **WHEN** the upstream answers a turn with a non-2xx status
- **THEN** the user's spend today is the same as before the turn

### Requirement: One request's cost is bounded

`POST /api/agent` SHALL refuse a request body larger than the configured limit
with 413, before the upstream is called and without charging the user. Every
upstream request SHALL carry the server's configured output limit as
`max_completion_tokens`, whatever the caller sent, so the worst-case cost of a
turn is known before the call.

#### Scenario: An oversized body is refused

- **WHEN** a signed-in user sends a body larger than the configured limit
- **THEN** the response is 413, the upstream `fetch` is not called, and the
  user's spend today is unchanged

#### Scenario: The caller cannot raise the output limit

- **WHEN** a signed-in user sends a turn whose body sets `max_tokens` or
  `max_completion_tokens`
- **THEN** the upstream request carries the server's configured
  `max_completion_tokens` and no `max_tokens`

### Requirement: Turns are served only by the configured providers

When providers are configured, every upstream request from `POST /api/agent`
SHALL restrict the Gateway to them, so a turn is served only by a provider in
the US region that retains no data and does not train on it. A caller SHALL NOT
be able to change the restriction.

#### Scenario: The upstream request names the providers

- **WHEN** providers are configured and a signed-in user sends a turn
- **THEN** the upstream request restricts routing to exactly the configured
  providers

#### Scenario: The caller cannot widen the list

- **WHEN** a signed-in user sends a turn whose body carries its own
  `providerOptions`
- **THEN** the upstream request carries only the configured restriction

#### Scenario: No providers configured

- **WHEN** no providers are configured
- **THEN** the upstream request carries no routing restriction

### Requirement: New GitHub accounts spend from their own pool

A user whose GitHub account is younger than the configured age, or whose
account age is not yet known, SHALL be in the `newcomer` tier; every other
signed-in user SHALL be in the `established` tier. A turn SHALL spend through
its tier's upstream key and be held to its tier's daily cap.

#### Scenario: A new account is a newcomer

- **WHEN** a user whose stored GitHub account creation date is more recent
  than the configured age sends a turn
- **THEN** the upstream request carries the `newcomer` key and the turn is held
  to the `newcomer` daily cap

#### Scenario: An old account is established

- **WHEN** a user whose stored GitHub account creation date is older than the
  configured age sends a turn
- **THEN** the upstream request carries the `established` key and the turn is
  held to the `established` daily cap

#### Scenario: An unknown account age is treated as new

- **WHEN** no creation date is stored for a user
- **THEN** the turn is in the `newcomer` tier

### Requirement: The account age is stored at sign-in

When a user signs in with GitHub on the deployment that hosts sign-in, the
GitHub account's creation date SHALL be stored with the user, so the user's
first turn is in the tier the account's age gives.

#### Scenario: A first turn after sign-in has the right tier

- **WHEN** a user whose GitHub account is older than the configured age signs
  in for the first time and sends a turn
- **THEN** the turn is `established`

### Requirement: The account age is learned after a turn

For a user with no stored GitHub account creation date, `POST /api/agent`
SHALL read the date from GitHub after the turn's response has ended, and keep
it. The read SHALL NOT delay any response. A read that fails SHALL store
nothing and be tried again after the user's next turn.

#### Scenario: The first turn learns the age

- **WHEN** a user with no stored creation date, whose GitHub account is older
  than the configured age, completes a turn, and sends another
- **THEN** the first turn was `newcomer`, the date is stored, and the second
  turn is `established`

#### Scenario: The lookup starts after the response ends

- **WHEN** a user with no stored creation date sends a turn and GitHub's
  answer is delayed
- **THEN** the turn's response completes before GitHub answers

#### Scenario: A failed lookup is tried again

- **WHEN** GitHub refuses the read after a user's turn
- **THEN** no date is stored, and the user's next turn is `newcomer` and
  starts another read

### Requirement: An exhausted pool is reported as such

When the upstream refuses a turn with `402` because a budget is spent (type
`quota_for_entity_exceeded`) or the credit balance is empty (type
`insufficient_funds`), `POST /api/agent` SHALL answer 503 with
`{ "reason": "pool-exhausted", "tier": <tier> }` and a `Retry-After` header
counting the seconds to the next 00:00 UTC, and SHALL NOT charge the user for
the turn.

#### Scenario: The tier's pool is empty

- **WHEN** the upstream answers a turn with 402 and type
  `quota_for_entity_exceeded`
- **THEN** the response is 503 with `reason` `pool-exhausted` and a
  `Retry-After` header, and the user's spend today is unchanged

#### Scenario: The credit balance is empty

- **WHEN** the upstream answers a turn with 402 and type
  `insufficient_funds`
- **THEN** the response is 503 with `reason` `pool-exhausted` and a
  `Retry-After` header, and the user's spend today is unchanged

### Requirement: The gate fails closed

When the spend ledger cannot be read or written, `POST /api/agent` SHALL answer
503 and SHALL NOT call the upstream.

#### Scenario: The ledger is unreachable

- **WHEN** a signed-in user sends a turn while the database holding the ledger
  refuses connections
- **THEN** the response is 503 and the upstream `fetch` is not called

### Requirement: The panel says why the default backend stopped

When the default backend refuses a turn with `daily-cap` or `pool-exhausted`,
the assistant panel SHALL show the sentence for that reason in the chat, keep
the conversation, and leave the backend picker available so the user can switch
to a key-based backend.

#### Scenario: The user reaches their daily cap

- **WHEN** a user connected to the default backend sends a message and
  `/api/agent` answers 429 with `reason` `daily-cap`
- **THEN** the chat shows "You have used today's free assistant allowance. It
  resets at 00:00 UTC, or bring your own key to keep going.", and the earlier
  messages of the conversation are still shown

#### Scenario: The tier's pool is empty

- **WHEN** a user connected to the default backend sends a message and
  `/api/agent` answers 503 with `reason` `pool-exhausted`
- **THEN** the chat shows "The free assistant is out of capacity for today. It
  resets at 00:00 UTC, or bring your own key to keep going.", and the earlier
  messages of the conversation are still shown

### Requirement: Refusals by a limit are tracked

`features/agent` SHALL track `agent_refused` once for each turn the default
backend refuses with `daily-cap` or `pool-exhausted`, with no parameters
beyond these:

- `reason`: `daily-cap` or `pool-exhausted`, from the response's `reason`.
- `tier`: `newcomer`, `established`, or `unknown` when the response carries
  no `tier`.

No other refusal (`signed-out`, 413, a 503 without `reason`) SHALL track it.

#### Scenario: A daily-cap refusal is tracked

- **WHEN** a user connected to the default backend sends a message and
  `/api/agent` answers 429 with `reason` `daily-cap` and `tier` `newcomer`
- **THEN** `agent_refused` with reason `daily-cap` and tier `newcomer` is
  tracked once

#### Scenario: A pool-exhausted refusal is tracked

- **WHEN** a user connected to the default backend sends a message and
  `/api/agent` answers 503 with `reason` `pool-exhausted` and `tier`
  `established`
- **THEN** `agent_refused` with reason `pool-exhausted` and tier `established`
  is tracked once

#### Scenario: A signed-out refusal is not tracked

- **WHEN** `/api/agent` answers 401 with `reason` `signed-out`
- **THEN** `agent_refused` is not tracked
