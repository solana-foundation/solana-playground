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

## Before the first deploy, squash -- but not while a PR is stacked on it

This schema has not shipped, and while that is true a new column belongs in the
`create table` that defines it rather than in an `ALTER TABLE` bolted on
afterwards. Roll back, edit, re-apply. The history should read as the schema,
not as the order things were discovered in.

**The exception, and it is the common case: a migration another open pull
request also edits gets a new file instead.** Two branches editing one
`create table` conflict in SQL on every rebase, and everyone holding a preview
database on the older shape needs a rollback and re-apply before they can run
either branch. A separate migration costs one extra file and nothing else, and
the squash can happen once, at the end, when nothing is in flight.
(Alexander's call on PR #30, 2026-09-23.)

Once the schema has been deployed the rule inverts everywhere: every change
becomes its own migration, because other databases are already in a state you
cannot edit away.

**Migrations are the source of truth.** `db/schema.sql` is the whole schema in
one file, for reading and reviewing — derived, never hand-edited. Regenerate it
with `yarn db-dump` after adding or editing a migration.

`db-dump` takes `pg_dump` **from the `postgres:16` image** rather than the host,
so no local Postgres client is needed and the dumper always matches the server
version (`pg_dump` refuses to dump a server newer than itself, and its output
differs between versions). Locally that is the compose container; CI has no
compose, so the same image runs as a one-off client against the service
container. Both produce identical bytes. It writes schema only — no owners or
grants, which differ per environment and would churn the file for non-schema
reasons — plus the `schema_migrations` rows, so the file records which migrations
it represents.

Four lines are filtered out, because `pg_dump` does not otherwise produce the
same file twice: the `\restrict`/`\unrestrict` pair carries a fresh random nonce
on every dump, and the `Dumped from/by ... version` comments pin the exact patch
release. Nothing replays this file, so losing them costs nothing — and without
it `client-v2.yml` could not check the file is current, which it now does on
every PR.

dbmate's own `--schema-file` dump is left unused for the same reason: it shells
out to a host `pg_dump`.

Migrations are **never** run from a serverless function: the platform would run
them concurrently on every cold start. Apply them as an explicit deploy step,
before flipping `SYNC_ENABLED` on an environment.

This database is separate from the MongoDB in `compose.yaml`, which belongs to
the Rust build server in `server/` and is upstream's. Nothing here touches it.
