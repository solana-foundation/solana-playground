-- One row per file, replacing the per-project `snapshot` jsonb.
--
-- A jsonb value is rewritten whole on every update -- Postgres cannot patch a
-- TOASTed value in place -- so a one-file edit to a 500 KB project wrote
-- ~500 KB of WAL. Measured against a row per file it was ~55x the write for
-- the same edit. Rows also give the push API something to patch: a client
-- sends only the paths that changed.
--
-- "Has no code" is now "has no rows here". `ensureConversation` still creates
-- a `projects` row with no files so a chat turn has a parent, and the
-- create-only write adopts exactly that state.

-- migrate:up

create table project_files (
  user_id    text not null,
  project_id text not null,
  path       text not null,
  content    text not null,
  primary key (user_id, project_id, path),
  foreign key (user_id, project_id)
    references projects (user_id, id) on delete cascade
);

-- Live rows only: a tombstone's snapshot was already cleared, and anything
-- that is not a map of strings was never restorable anyway.
insert into project_files (user_id, project_id, path, content)
select p.user_id, p.id, f.key, f.value
  from projects p
 cross join lateral jsonb_each_text(p.snapshot -> 'files') f
 where p.deleted_at is null
   and jsonb_typeof(p.snapshot -> 'files') = 'object';

-- `snapshot_hash` was created and never written
alter table projects
  drop column snapshot,
  drop column snapshot_hash;

-- migrate:down

alter table projects
  add column snapshot jsonb,
  add column snapshot_hash text;

update projects p
   set snapshot = jsonb_build_object('files', f.files)
  from (
    select user_id, project_id, jsonb_object_agg(path, content) as files
      from project_files
     group by user_id, project_id
  ) f
 where p.user_id = f.user_id and p.id = f.project_id;

drop table project_files;
