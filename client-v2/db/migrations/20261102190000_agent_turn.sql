-- One row per admitted `/api/agent` turn, and a count of the turns the daily
-- cap refused, for reading usage per account in any window (HOO-2396).
-- `agent_spend` keeps only a day's sum; the quota's real shape is to be set
-- from these. See `features/agent/server/ledger.mjs` for the statements that
-- write them.

-- migrate:up

-- `outcome` is the ledger's `TurnEnd` kind. Tokens are what the upstream
-- reported for a `completed` turn and null otherwise, or when the upstream's
-- count was not a usable integer. `day` is the UTC day the turn was reserved
-- on, the one its charge lands on in `agent_spend`; `at` is when it settled,
-- which for a turn that runs past midnight is the next day. `charged` is
-- micro-USD.
create table agent_turn (
  id                bigserial primary key,
  user_id           text not null references "user" ("id") on delete cascade,
  day               date not null,
  at                timestamptz not null default now(),
  tier              text not null,
  outcome           text not null,
  prompt_tokens     integer,
  completion_tokens integer,
  charged           bigint not null default 0,
  constraint agent_turn_outcome_check check (
    outcome in ('completed', 'unfinished', 'refused', 'abandoned')
  ),
  constraint agent_turn_tier_check check (tier in ('newcomer', 'established')),
  constraint agent_turn_charged_check check (charged >= 0),
  constraint agent_turn_tokens_check check (
    (prompt_tokens is null or prompt_tokens >= 0)
    and (completion_tokens is null or completion_tokens >= 0)
    and (outcome = 'completed'
         or (prompt_tokens is null and completion_tokens is null))
  )
);

create index agent_turn_user_at on agent_turn (user_id, at);

-- A turn the cap refused is counted, not logged: it costs nothing, and a
-- capped user retrying in a loop would otherwise grow `agent_turn` by a row
-- per request.
alter table agent_spend add column capped integer not null default 0;

-- migrate:down

alter table agent_spend drop column if exists capped;
drop table if exists agent_turn;
