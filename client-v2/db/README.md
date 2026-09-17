# Database

Plain SQL migrations, applied with [dbmate](https://github.com/amacneil/dbmate).
`dbmate` is a single binary and is **not** a package dependency. Install it
however suits the machine; CI uses the release download in
`.github/workflows/client-v2.yml`.

```sh
brew install dbmate                 # if Homebrew is healthy

# Otherwise, the same binary the CI job fetches (pick your arch):
mkdir -p ~/.local/bin && curl -fsSL -o ~/.local/bin/dbmate \
  https://github.com/amacneil/dbmate/releases/latest/download/dbmate-macos-amd64
chmod +x ~/.local/bin/dbmate        # then put ~/.local/bin on PATH
```

Verified against dbmate 2.35.1.

- `yarn db-new <name>` writes a new migration stub.
- `yarn db-migrate` applies pending migrations against `DATABASE_URL`.
- `yarn db-rollback` reverts the last one. Every migration must have a working
  `-- migrate:down`; one that cannot be rolled back cannot be reviewed.
- `yarn db-status` lists applied and pending migrations.

## Before the first deploy, squash

This schema has not shipped. While that is true there are **exactly two
migrations** -- Better Auth's tables, and ours -- and a new column goes into the
`create table` that defines it, not into an `ALTER TABLE` bolted on afterwards.
Roll back, edit, re-apply. The history should read as the schema, not as the
order things were discovered in.

Once it has been deployed the rule inverts: every change becomes its own
migration, because other databases are already in a state you cannot edit away.

**Migrations are the source of truth.** `db/schema.sql` is the whole schema in
one file, for reading and reviewing — derived, never hand-edited. Regenerate it
with `yarn db-dump` after adding or editing a migration.

`db-dump` runs `pg_dump` **inside the compose `postgres` container** rather than
on the host, so no local Postgres client is needed and the dumper always matches
the server version (`pg_dump` refuses to dump a server newer than itself). It
writes schema only — no owners or grants, which differ per environment and would
churn the file for non-schema reasons — plus the `schema_migrations` rows, so the
file records which migrations it represents.

dbmate's own `--schema-file` dump is left unused for the same reason: it shells
out to a host `pg_dump`.

Migrations are **never** run from a serverless function: the platform would run
them concurrently on every cold start. Apply them as an explicit deploy step,
before flipping `SYNC_ENABLED` on an environment.

This database is separate from the MongoDB in `compose.yaml`, which belongs to
the Rust build server in `server/` and is upstream's. Nothing here touches it.
