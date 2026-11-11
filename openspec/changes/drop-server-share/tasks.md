# Tasks

All groups land in one PR. Groups 1 and 2 may run at the same time. Group 3 depends on 1, and group 4 on 1, 2,
and 3.

## 1. Server

- [x] 1.1 Remove the share routes and the database from `server/`: `routes/share.rs` and its exports in
      `routes/mod.rs`, the `/share/{id}` and `/new` routes and `db::init` in `main.rs`, `db.rs` and `pub mod db` in
      `lib.rs`, `db_uri` and `db_name` in `config.rs`, and the `mongodb` crate in `Cargo.toml`, with
      `server/Cargo.lock` updated by cargo. Verify: `cargo fmt --check`, `cargo clippy` and `cargo test` pass in
      `server/`, with and without `--features unstable`, and `grep -ri mongo server/src server/Cargo.toml` prints
      nothing. HOO-2790.
- [x] 1.2 Update `server/README.md` so its setup no longer creates a MongoDB database, and drop the database
      sentence from its App Engine section. Verify: `grep -i -e mongo -e PG_DB_URI server/README.md` prints
      nothing. Depends on 1.1. HOO-2790.

## 2. client-v2

- [x] 2.1 Delete `src/utils/share.ts` and its export in `src/utils/index.ts`; `shareGet`, `shareNew`,
      `ShareNewRequest` and the `useDbServer` option in `src/utils/server.ts`, with the `shareNew` case in
      `src/utils/server.test.ts`; the folder `src/routes/share/`; and `Modals/Share.tsx` with its export in
      `src/views/sidebar/explorer/Component/Modals/index.ts`. Run `yarn generate` so `routes/generated.ts` drops
      the route. Verify: `yarn run check` passes, `git grep -n -e PgShare -e shareGet -e shareNew -e useDbServer
      -- client-v2/src` prints nothing, and `--max-warnings` is lowered if the total fell. HOO-2790.
- [x] 2.2 Remove the share lines from `client-v2/docs/deploy-client-vercel.md` ("Share routes (`/share/*`,
      `/new`)"), and reword the line before them so it does not contrast with share routes. Verify: `grep -n
      "/share" client-v2/docs/deploy-client-vercel.md` prints nothing. HOO-2790.

## 3. Local stack and docs

- [x] 3.1 In `compose.yaml`, remove the `db` service, the `mongodb` volume, `depends_on: db` and `PG_DB_URI` on
      `server`, and the MongoDB reasons in the comments on `server-standalone` and `postgres`. Remove `PG_DB_NAME`
      and `PG_DB_URI` from `.env.example`. Verify: `docker compose --profile dev config --services` lists no `db`,
      and `docker compose config` succeeds for every profile. Depends on 1.1. HOO-2790.
- [x] 3.2 Update `docs/testing.md` as `design.md` ("Decisions", docs/testing.md) lists: delete D-4, and change
      section 2, D-1, D-6, and U-2. Update the MongoDB paragraph in the root `CLAUDE.md` "Gotchas", the MongoDB
      sentence in `docs/persistent-conversations-spec.md`, and the comment in
      `.github/workflows/reusable-client-v2.yml`. Verify: `git grep -n -i mongo -- docs CLAUDE.md compose.yaml
      .github .env.example` prints nothing outside quoted history. Depends on 3.1. HOO-2790.

## 4. Integration

- [x] 4.1 Run the `build-server` scenarios against `docker compose --profile v2 up --build`: `GET /share/<id>`
      and `POST /new` return 404, and an Anchor starter builds through client-v2 with no `db` service running.
      Record the commands and responses in the PR description. Depends on 1.1, 2.1, and 3.1. HOO-2790.
