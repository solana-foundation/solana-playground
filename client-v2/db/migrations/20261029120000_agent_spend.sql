-- What the default assistant backend (`/api/agent`) has spent per user per
-- UTC day, and the GitHub account's creation date that decides the user's
-- tier. See `features/agent/server/ledger.mjs` for the statements that read
-- and write it.

-- migrate:up

-- Declared to Better Auth as `user.additionalFields.githubCreatedAt` and
-- filled by `mapProfileToUser` at sign-in, like "login". `/api/agent` fills it
-- for a user sign-in did not cover (signed in before this column, or through
-- the OAuth proxy). Null means "not known yet", which the ledger reads as a
-- new account.
alter table "user" add column "githubCreatedAt" timestamptz;

-- Amounts are integers in micro-USD: the cost of a turn is a fraction of a
-- cent, and a float would drift as rows accumulate many of them.
--
-- `reserved` holds the worst-case cost of turns still streaming; `settle`
-- moves each one into `spent` when the turn ends. A function that dies in
-- between leaves its reservation here until the day is over, which
-- overcharges the user and never undercharges them.
--
-- `day` is the UTC date, the same boundary the Gateway's daily budgets reset
-- on, so a user's cap and their tier's pool reset together.
create table agent_spend (
  user_id  text not null references "user" ("id") on delete cascade,
  day      date not null,
  reserved bigint not null default 0,
  spent    bigint not null default 0,
  constraint agent_spend_amounts_check check (reserved >= 0 and spent >= 0),
  primary key (user_id, day)
);

-- migrate:down

drop table if exists agent_spend;
alter table "user" drop column if exists "githubCreatedAt";
