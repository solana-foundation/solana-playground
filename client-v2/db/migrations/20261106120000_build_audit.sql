-- One row per build that `/api/build-server` forwards to the build server
-- (HOO-2422): who built, when, which project, and how it ended. See
-- `features/build-server/server/audit.mjs` for the statements that write it.

-- migrate:up

-- No foreign key to "user": the record of who built what outlives the account,
-- so `github_id` and `login` are copied in to keep naming a deleted user.
-- `github_id` is the GitHub account id from the user's `account` row: every
-- GitHub user has one, it never changes, and `https://api.github.com/user/<id>`
-- turns it back into the current handle. `login` alone was not enough, since
-- sign-in stores it only when it creates the user, so one created before the
-- column or through the OAuth proxy on a preview has none.
-- `project_id` and `project_name` are what the client sent, cut to 200
-- characters by `projectOf`; `program_uuid` is the build server's, or the
-- request's when the server issued none, and only ever UUID-shaped. `status` is
-- the build server's, or 499 when the caller left first and 502 when the
-- server could not be reached or refused the route. `status` and
-- `duration_ms` stay null when the function died before the build ended.
create table build_audit (
  id            bigserial primary key,
  user_id       text not null,
  login         text,
  github_id     text,
  at            timestamptz not null default now(),
  project_id    text,
  project_name  text,
  program_uuid  text,
  unstable      boolean not null,
  request_bytes integer not null,
  status        integer,
  duration_ms   integer,
  constraint build_audit_request_bytes_check check (request_bytes >= 0),
  constraint build_audit_duration_check check (duration_ms is null or duration_ms >= 0)
);

create index build_audit_user_at_idx on build_audit (user_id, at);

-- migrate:down

drop table build_audit;
