-- Conversations, project snapshots, and the messages inside a conversation.
--
-- Unquoted snake_case here, unlike the Better Auth tables next door: these are
-- ours. The only crossing is `user_id`, which must quote "user" because that
-- is a reserved word.

-- migrate:up

-- `id` is text rather than uuid on purpose. A tutorial's project id is
-- derived (`tut:<slug>`) so two devices converge on one row for the same
-- tutorial without coordinating; a personal project gets a client-minted uuid,
-- because two projects that happen to share a name are not the same project.
-- Keyed by (user_id, id), not id alone. A tutorial's id is derived from its
-- name so that two devices agree on it without coordinating, which means every
-- user who starts Hello Anchor produces the same `tut:hello-anchor`. Under a
-- global primary key the second user to ever open a tutorial would collide
-- with the first -- and with `on conflict do nothing`, silently attach to a row
-- somebody else owns.
-- `timestamptz(3)`, not bare `timestamptz`, on every column here and below.
-- These timestamps cross into JavaScript and come back: `updated_at` is handed
-- to a client as the token it must echo to prove its write is not built on a
-- stale read. Postgres keeps microseconds, `Date#toISOString` emits
-- milliseconds, so a full-precision `now()` round-trips as a value that can
-- never equal what is stored -- every optimistic write would report a conflict
-- with itself. Storing what the wire format can represent removes the class of
-- bug rather than making each comparison remember to truncate.
create table projects (
  id            text not null,
  user_id       text not null references "user" ("id") on delete cascade,
  name          text not null,
  kind          text not null default 'project',
  snapshot      jsonb,
  snapshot_hash text,
  updated_at    timestamptz(3) not null default now(),
  deleted_at    timestamptz(3),
  constraint projects_kind_check check (kind in ('project', 'tutorial')),
  primary key (user_id, id)
);

create index projects_user_idx on projects (user_id) where deleted_at is null;

-- Names are unique per user among live rows only, so a tombstoned project
-- frees its name for reuse. An import that collides is suffixed by the client
-- rather than merged.
create unique index projects_user_name_idx
  on projects (user_id, name) where deleted_at is null;

-- A conversation has its own key rather than being identified by its project,
-- so a project can hold several threads. Only one is created today and the UI
-- for picking between them comes later, but the shape is here now: adding it
-- afterwards would mean migrating live rows.
create table conversations (
  id         uuid primary key,
  user_id    text not null references "user" ("id") on delete cascade,
  project_id text,
  -- What a thread picker shows. Null means "untitled", to be derived from the
  -- first message rather than stored twice.
  title      text,
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  -- Tombstoned like projects: another device's sync must see "deleted" rather
  -- than "missing", or it pushes the thread straight back
  deleted_at timestamptz(3),
  -- Composite, matching the key above: a project is only identified together
  -- with its owner
  constraint conversations_project_fkey
    foreign key (user_id, project_id) references projects (user_id, id)
    on delete cascade
);

-- Deliberately NOT unique: several threads may share a project. The client
-- keeps one per project for now and opens the most recently updated, which is
-- a convention it can relax without touching the schema.
--
-- The cost of dropping uniqueness is that a concurrent "find or create" can
-- race into two threads. That is survivable -- both are real conversations and
-- the newest wins the default -- whereas a unique constraint here would have
-- to be dropped later against live data.
create index conversations_project_idx
  on conversations (user_id, project_id, updated_at desc)
  where project_id is not null and deleted_at is null;

-- Keyed by (conversation_id, id), not id alone -- the same argument as
-- (user_id, id) on `projects`, one level further down, where the row actually
-- hangs. A message's id arrives verbatim in the request body, so it is a claim
-- the client makes rather than a fact the server established, and is only
-- unique inside the scope that minted it. Under a global key, with the
-- insert's `on conflict do nothing`, one account posting an id another
-- account's client had already used would have its write dropped in silence
-- while the route reported success -- and the count the route returns would
-- then answer a question nobody asked it, namely whether that id exists
-- anywhere at all. `crypto.randomUUID` does not collide by accident, but
-- nothing forces a client to use it; the id is simply accepted.
--
-- (conversation_id, id) rather than (user_id, conversation_id, id) because a
-- conversation id is server-minted and a conversation belongs to exactly one
-- user, so scoping by the conversation already scopes by the owner. The
-- idempotent re-dumps the `on conflict` exists for keep working, because a
-- repeat carries the same conversation.
create table messages (
  id              uuid not null,
  conversation_id uuid not null references conversations (id) on delete cascade,
  kind            text not null,
  payload         jsonb not null,
  created_at      timestamptz(3) not null,
  constraint messages_kind_check
    check (kind in ('user', 'assistant', 'tool', 'approval', 'error', 'notice')),
  primary key (conversation_id, id)
);

-- Matches the only read: one thread, in order. `id` breaks ties between two
-- devices that minted a message in the same millisecond, which is why
-- ordering needs no server-allocated sequence.
--
-- The primary key does not make this redundant. Its index is
-- (conversation_id, id), which serves the lookup the insert's `on conflict`
-- does but carries no ordering by `created_at` at all, so it cannot serve
-- `order by created_at, id` within a thread. The two cover different halves of
-- the only two statements this table has, and both are kept.
create index messages_conversation_idx
  on messages (conversation_id, created_at, id);

-- migrate:down

drop table if exists messages;
drop table if exists conversations;
drop table if exists projects;
