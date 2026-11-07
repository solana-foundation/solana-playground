# assistant-server-env Specification

## Purpose

Names the assistant's server-side environment variables, so a Vercel project
reads as Playground's AI settings, and keeps a deployment that still sets the
old names working until it is renamed.

## Requirements

### Requirement: The assistant's variables use the PG*AI* prefix

`agentEnv` SHALL read each of its settings from `PG_AI_<NAME>`: `API_KEY`,
`NEWCOMER_API_KEY`, `BASE_URL`, `MODEL`, `REASONING_EFFORT`, `PROVIDERS`,
`PRICE_INPUT`, `PRICE_OUTPUT`, `MAX_BODY_BYTES`, `MAX_OUTPUT_TOKENS`,
`NEWCOMER_AGE_DAYS`, `NEWCOMER_DAILY_CAP` and `ESTABLISHED_DAILY_CAP`, with
the defaults and validation they had under `AGENT_<NAME>`.

#### Scenario: New name read (manual)

- **WHEN** `PG_AI_MODEL` is set
- **THEN** `agentEnv().MODEL` is its value

#### Scenario: Empty provider list still means no restriction (manual)

- **WHEN** `PG_AI_PROVIDERS` is set to an empty string
- **THEN** `agentEnv().PROVIDERS` is an empty list, whatever the base URL

### Requirement: The old AGENT\_ names are a deprecated fallback

When `PG_AI_<NAME>` is not set at all, `agentEnv` SHALL read `AGENT_<NAME>`
and log one warning per old name per process, naming the new variable. A
`PG_AI_<NAME>` that is set, even to an empty string, SHALL win over
`AGENT_<NAME>`.

#### Scenario: Old name read with a warning (manual)

- **WHEN** only `AGENT_API_KEY` is set and `agentEnv` is called twice
- **THEN** `API_KEY` is its value both times, and one warning names `AGENT_API_KEY` and `PG_AI_API_KEY`

#### Scenario: New name wins (manual)

- **WHEN** both `PG_AI_MODEL` and `AGENT_MODEL` are set
- **THEN** `agentEnv().MODEL` is the value of `PG_AI_MODEL`

#### Scenario: A differing old value is reported as ignored (manual)

- **WHEN** `PG_AI_API_KEY` and `AGENT_API_KEY` are set to different values and `agentEnv` is called twice
- **THEN** `API_KEY` is the value of `PG_AI_API_KEY`, and one warning says `AGENT_API_KEY` is ignored, without either value

#### Scenario: Empty new name does not fall back (manual)

- **WHEN** `PG_AI_API_KEY` is set to an empty string and `AGENT_API_KEY` to a key
- **THEN** `agentEnv().API_KEY` is `undefined`

### Requirement: The build check accepts either key name

`check-agent-env` SHALL pass a Vercel build whose key is in `PG_AI_API_KEY`,
or, when `PG_AI_API_KEY` is not set at all, in `AGENT_API_KEY`, and SHALL fail
it, naming `PG_AI_API_KEY`, when the key it reads is unset or empty. It SHALL
warn, listing them, whenever any deprecated `AGENT_*` name is set.

#### Scenario: Old key name passes with a warning (manual)

- **WHEN** a Vercel preview build sets `AGENT_API_KEY` and not `PG_AI_API_KEY`
- **THEN** the check exits `0` and its warning lists `AGENT_API_KEY` among the deprecated names still set

#### Scenario: Every old name is listed (manual)

- **WHEN** a Vercel build sets `PG_AI_API_KEY`, `AGENT_MODEL` and `AGENT_NEWCOMER_API_KEY`
- **THEN** the check exits `0` and its warning names both old variables

#### Scenario: No key fails with the new name (manual)

- **WHEN** a Vercel build sets neither variable
- **THEN** the check exits non-zero with a message naming `PG_AI_API_KEY`
